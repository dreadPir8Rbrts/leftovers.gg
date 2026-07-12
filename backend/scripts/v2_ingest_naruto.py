"""Ingest Naruto CCG cards from the CCG Trader Directus API.

Data sources:
  Set list:  https://www.ccgtrader.net/page-data/games/naruto-ccg/page-data.json
  Cards:     https://api.ccgtrader.co.uk/_/items/card?filter[set][eq]={set_id}&limit=99999

Usage:
  cd backend
  python scripts/v2_ingest_naruto.py [--dry-run] [--mirror-images] [--set-id 882]
"""

import argparse
import logging
import sys
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import boto3
import httpx

sys.path.insert(0, ".")
from app.db.session import engine, settings
from sqlalchemy.orm import Session

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)

GAME = "naruto_ccg"
LANGUAGE = "English"
LANGUAGE_CODE = "EN"
S3_PREFIX = "naruto-ccg"

GAME_PAGE_DATA_URL = "https://www.ccgtrader.net/page-data/games/naruto-ccg/page-data.json"
DIRECTUS_API_BASE = "https://api.ccgtrader.co.uk/_"

CARD_FIELDS = ",".join([
    "id", "name", "subtitle", "url_title", "type", "reference",
    "rarity.name", "rarity.id",
    "image_url", "image.data.asset_url",
    "set.id", "set.name", "set.series.name",
])

HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Origin": "https://www.ccgtrader.net",
    "Referer": "https://www.ccgtrader.net/",
}

# Polite delay between API calls (seconds)
REQUEST_DELAY = 0.5


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _parse_reference(reference: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """Split 'PTHN-041' into ('PTHN-041', '041'). Returns (number, printed_number)."""
    if not reference:
        return None, None
    if "-" in reference:
        printed = reference.split("-", 1)[1].strip()
        return reference.strip(), printed
    return reference.strip(), None


def _image_url_from_card(card: Dict[str, Any]) -> Optional[str]:
    """Resolve the best available image URL for a card."""
    # Prefer the direct image_url if present
    if card.get("image_url"):
        return card["image_url"]
    # Fall back to Directus asset — asset_url already starts with /_/assets/...
    try:
        asset_url = card["image"]["data"]["asset_url"]
        return f"https://api.ccgtrader.co.uk{asset_url}?key=card-medium"
    except (KeyError, TypeError):
        return None


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def fetch_sets(client: httpx.Client) -> List[Dict[str, Any]]:
    """Fetch all Naruto CCG sets from the Gatsby page-data JSON."""
    resp = client.get(GAME_PAGE_DATA_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    time.sleep(REQUEST_DELAY)

    game_data = resp.json()
    series_list = game_data["result"]["data"]["directusGame"]["series"]

    sets = []
    for series in series_list:
        series_name = series["name"]
        for s in series["sets"]:
            sets.append({
                "directus_id": s["directusId"],
                "name": s["name"],
                "url_title": s["url_title"],
                "series_name": series_name,
            })
            logger.info("  Found set: %s  (id=%d, series=%s)", s["name"], s["directusId"], series_name)

    return sets


def fetch_cards_for_set(client: httpx.Client, set_directus_id: int) -> List[Dict[str, Any]]:
    """Fetch all cards for a set in one API call."""
    url = f"{DIRECTUS_API_BASE}/items/card"
    params = {
        "filter[set][eq]": set_directus_id,
        "limit": 99999,
        "fields": CARD_FIELDS,
    }
    resp = client.get(url, params=params, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    time.sleep(REQUEST_DELAY)
    return resp.json().get("data", [])


# ---------------------------------------------------------------------------
# Image mirroring
# ---------------------------------------------------------------------------

def _make_s3_client() -> Any:
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
    )


def mirror_image(
    s3: Any,
    client: httpx.Client,
    source_url: str,
    set_external_id: str,
    card_external_id: str,
) -> Optional[str]:
    """Download image from source_url and upload to S3. Returns public S3 URL or None."""
    ext = source_url.split("?")[0].rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    s3_key = f"{S3_PREFIX}/{set_external_id}/{card_external_id}.{ext}"

    try:
        resp = client.get(source_url, timeout=20, follow_redirects=True)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("Failed to download image %s: %s", source_url, exc)
        return None

    content_type = resp.headers.get("content-type", "image/jpeg").split(";")[0]

    try:
        s3.put_object(
            Bucket=settings.aws_s3_bucket,
            Key=s3_key,
            Body=resp.content,
            ContentType=content_type,
        )
    except Exception as exc:
        logger.warning("Failed to upload %s to S3: %s", s3_key, exc)
        return None

    return f"https://{settings.aws_s3_bucket}.s3.{settings.aws_region}.amazonaws.com/{s3_key}"


# ---------------------------------------------------------------------------
# DB upsert
# ---------------------------------------------------------------------------

def upsert_expansion(session: Session, set_info: Dict[str, Any], now: datetime) -> uuid.UUID:
    """Upsert an expansions_v2 row and return its UUID."""
    from app.models.catalog_v2 import ExpansionV2

    external_id = str(set_info["directus_id"])
    existing = (
        session.query(ExpansionV2)
        .filter_by(game=GAME, external_id=external_id)
        .first()
    )
    if existing:
        existing.name = set_info["name"]
        existing.last_synced_at = now
        session.flush()
        return existing.id

    row = ExpansionV2(
        id=uuid.uuid4(),
        external_id=external_id,
        game=GAME,
        name=set_info["name"],
        language=LANGUAGE,
        language_code=LANGUAGE_CODE,
        last_synced_at=now,
    )
    session.add(row)
    session.flush()
    return row.id


def upsert_card(
    session: Session,
    expansion_id: uuid.UUID,
    card: Dict[str, Any],
    now: datetime,
    s3: Optional[Any],
    client: Optional[httpx.Client],
    set_external_id: str,
) -> bool:
    """Upsert a cards_v2 row. Returns True if inserted, False if updated."""
    from app.models.catalog_v2 import CardV2

    external_id = str(card["id"])
    number, printed_number = _parse_reference(card.get("reference"))

    # Card name — append subtitle in parentheses when present
    name = card["name"]
    if card.get("subtitle"):
        name = f"{name} ({card['subtitle']})"

    # Rarity
    rarity_obj = card.get("rarity")
    rarity = rarity_obj["name"] if isinstance(rarity_obj, dict) else None

    # Type → tags JSONB
    card_type = card.get("type")
    tags = [card_type] if card_type else None

    # Image
    source_image_url = _image_url_from_card(card)
    image_url = source_image_url
    if s3 and client and source_image_url:
        mirrored = mirror_image(s3, client, source_image_url, set_external_id, external_id)
        if mirrored:
            image_url = mirrored
    images = {"small": image_url} if image_url else None

    existing = (
        session.query(CardV2)
        .filter_by(game=GAME, external_id=external_id)
        .first()
    )
    if existing:
        existing.name = name
        existing.number = number
        existing.printed_number = printed_number
        existing.rarity = rarity
        existing.tags = tags
        existing.images = images
        existing.last_synced_at = now
        return False

    session.add(CardV2(
        id=uuid.uuid4(),
        external_id=external_id,
        game=GAME,
        expansion_id=expansion_id,
        name=name,
        number=number,
        printed_number=printed_number,
        rarity=rarity,
        language=LANGUAGE,
        language_code=LANGUAGE_CODE,
        tags=tags,
        images=images,
        last_synced_at=now,
    ))
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest Naruto CCG cards from CCG Trader API")
    parser.add_argument("--dry-run", action="store_true", help="Fetch only, do not write to DB")
    parser.add_argument("--mirror-images", action="store_true", help="Download images and upload to S3")
    parser.add_argument("--set-id", type=int, help="Only ingest one set by its Directus ID")
    args = parser.parse_args()

    s3 = None
    if args.mirror_images:
        if not settings.aws_s3_bucket:
            logger.error("--mirror-images requires AWS_S3_BUCKET to be set in .env")
            sys.exit(1)
        s3 = _make_s3_client()
        logger.info("Image mirroring enabled → s3://%s/%s/", settings.aws_s3_bucket, S3_PREFIX)

    with httpx.Client() as client, Session(engine) as session:
        logger.info("=== Fetching set list ===")
        sets = fetch_sets(client)
        logger.info("Found %d sets\n", len(sets))

        if args.set_id:
            sets = [s for s in sets if s["directus_id"] == args.set_id]
            if not sets:
                logger.error("No set found with directus_id=%d", args.set_id)
                sys.exit(1)

        total_inserted = total_updated = 0

        for set_info in sets:
            logger.info("--- %s  (id=%d) ---", set_info["name"], set_info["directus_id"])
            cards = fetch_cards_for_set(client, set_info["directus_id"])
            logger.info("  Fetched %d cards", len(cards))

            if args.dry_run:
                for c in cards[:3]:
                    logger.info("  [dry-run] id=%s name=%r ref=%s rarity=%s type=%s",
                                c.get("id"), c.get("name"), c.get("reference"),
                                c.get("rarity", {}).get("name") if isinstance(c.get("rarity"), dict) else None,
                                c.get("type"))
                continue

            now = datetime.utcnow()
            set_external_id = str(set_info["directus_id"])
            expansion_id = upsert_expansion(session, set_info, now)

            inserted = updated = 0
            for card in cards:
                was_inserted = upsert_card(
                    session, expansion_id, card, now,
                    s3, client if s3 else None, set_external_id,
                )
                if was_inserted:
                    inserted += 1
                else:
                    updated += 1

            session.commit()
            logger.info("  ✓ %d inserted, %d updated\n", inserted, updated)
            total_inserted += inserted
            total_updated += updated

    if not args.dry_run:
        logger.info("=== Done: %d inserted, %d updated ===", total_inserted, total_updated)
    else:
        logger.info("=== Dry run complete — no DB writes ===")


if __name__ == "__main__":
    main()
