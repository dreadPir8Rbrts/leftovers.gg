"""Ingest Naruto CCG singles from goatcardsshop.crystalcommerce.com.

Scrapes all set sub-categories under:
  https://goatcardsshop.crystalcommerce.com/catalog/naruto_ccg_singles/3837

For each set, paginates through all pages and upserts:
  - One expansions_v2 row per set
  - One cards_v2 row per card listing (1st Edition and Unlimited are separate rows)

Usage:
  cd backend
  python scripts/ingest_naruto_ccg.py [--dry-run] [--mirror-images]
"""

import argparse
import logging
import random
import re
import sys
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import boto3
import httpx
from bs4 import BeautifulSoup

sys.path.insert(0, ".")
from app.db.session import engine, settings
from sqlalchemy.orm import Session

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)

BASE_URL = "https://goatcardsshop.crystalcommerce.com"
ROOT_CATEGORY = "/catalog/naruto_ccg_singles/3837"
GAME = "naruto_ccg"
LANGUAGE = "English"
LANGUAGE_CODE = "EN"
S3_PREFIX = "naruto-ccg"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# Random delay range between requests (seconds)
REQUEST_DELAY_MIN = 3.0
REQUEST_DELAY_MAX = 6.0


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _parse_card_title(title: str) -> Dict[str, Optional[str]]:
    """Parse a CrystalCommerce card title into components.

    Expected format: "Card Name - N-001 - Rare - 1st Edition"
    Handles titles with fewer segments gracefully.
    """
    parts = [p.strip() for p in title.split(" - ")]
    name    = parts[0] if len(parts) > 0 else title
    number  = parts[1] if len(parts) > 1 else None
    rarity  = parts[2] if len(parts) > 2 else None
    edition = parts[3] if len(parts) > 3 else None
    return {"name": name, "number": number, "rarity": rarity, "edition": edition}


def _set_slug_from_url(path: str) -> str:
    """Extract set slug from a category URL path.

    e.g. /catalog/naruto_ccg_singles-the_chosen/3886 → the_chosen
    """
    segment = path.split("/")[2]  # naruto_ccg_singles-the_chosen
    if "-" in segment:
        return segment.split("-", 1)[1]
    return segment


def _category_id_from_url(path: str) -> str:
    """Extract numeric category ID from URL, e.g. /catalog/.../3886 → '3886'."""
    return path.rstrip("/").split("/")[-1]


def _product_id_from_url(path: str) -> str:
    """Extract numeric product ID from a product URL, e.g. /.../609845 → '609845'."""
    return path.rstrip("/").split("/")[-1]


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _fetch(client: httpx.Client, url: str) -> Optional[BeautifulSoup]:
    try:
        resp = client.get(url, headers=HEADERS, follow_redirects=True, timeout=30)
        resp.raise_for_status()
        time.sleep(random.uniform(REQUEST_DELAY_MIN, REQUEST_DELAY_MAX))
        return BeautifulSoup(resp.text, "lxml")
    except httpx.HTTPError as exc:
        logger.error("HTTP error fetching %s: %s", url, exc)
        time.sleep(random.uniform(REQUEST_DELAY_MIN, REQUEST_DELAY_MAX))
        return None


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
    source_url: str,
    set_external_id: str,
    card_external_id: str,
) -> Optional[str]:
    """Download an image from source_url and upload it to S3.

    Returns the public S3 URL, or None on failure.
    S3 key: naruto-ccg/{set_id}/{card_id}.jpg
    """
    ext = source_url.rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    s3_key = f"{S3_PREFIX}/{set_external_id}/{card_external_id}.{ext}"

    try:
        resp = httpx.get(source_url, timeout=20, follow_redirects=True)
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
# Scraping
# ---------------------------------------------------------------------------

def get_set_links(client: httpx.Client) -> List[Dict[str, str]]:
    """Scrape the root category page and return all set sub-category links."""
    url = urljoin(BASE_URL, ROOT_CATEGORY)
    soup = _fetch(client, url)
    if not soup:
        return []

    sets = []
    seen = set()
    for a in soup.select("a[href*='naruto_ccg_singles-']"):
        href = a.get("href", "")
        # Only category-style links (end in a numeric ID)
        path = urlparse(href).path
        if not re.search(r"/\d+$", path):
            continue
        if path in seen:
            continue
        seen.add(path)
        # Skip the root category itself
        cat_id = _category_id_from_url(path)
        if cat_id == "3837":
            continue
        set_name = a.get_text(strip=True)
        if not set_name:
            continue
        sets.append({
            "path": path,
            "external_id": cat_id,
            "slug": _set_slug_from_url(path),
            "name": set_name,
        })
        logger.info("  Found set: %s  (id=%s)", set_name, cat_id)

    return sets


def scrape_set_page(client: httpx.Client, set_path: str, page: int) -> Tuple[List[Dict[str, Any]], bool]:
    """Fetch one page of a set category. Returns (cards, has_next_page)."""
    url = urljoin(BASE_URL, set_path)
    if page > 1:
        url = f"{url}?page={page}&sort_by_price=0"

    soup = _fetch(client, url)
    if not soup:
        return [], False

    cards = []
    for li in soup.select("li"):
        a = li.find("a", href=True)
        if not a:
            continue
        href = a.get("href", "")
        # Product links have a numeric ID at the end and contain the set slug
        if not re.search(r"/\d+$", href):
            continue
        # Skip category links (they're just the set path)
        if re.search(r"^/catalog/naruto_ccg_singles[^/]*/\d+$", href):
            continue

        h4 = li.find("h4")
        if not h4:
            continue
        title = h4.get_text(strip=True)
        if not title:
            continue

        img = li.find("img")
        image_url = img.get("src") if img else None

        product_id = _product_id_from_url(urlparse(href).path)
        parsed = _parse_card_title(title)

        cards.append({
            "external_id": product_id,
            "title": title,
            "image_url": image_url,
            **parsed,
        })

    # Check for a next page link
    next_link = soup.find("a", string=re.compile(r"Next", re.I))
    has_next = next_link is not None

    return cards, has_next


def scrape_set(client: httpx.Client, set_info: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Scrape all pages of a set, returning all card dicts."""
    all_cards = []
    page = 1
    while True:
        logger.info("    Page %d ...", page)
        cards, has_next = scrape_set_page(client, set_info["path"], page)
        all_cards.extend(cards)
        logger.info("    → %d cards on page %d (total so far: %d)", len(cards), page, len(all_cards))
        if not has_next or not cards:
            break
        page += 1
    return all_cards


# ---------------------------------------------------------------------------
# DB upsert
# ---------------------------------------------------------------------------

def upsert_expansion(session: Session, set_info: Dict[str, str], now: datetime) -> uuid.UUID:
    """Upsert an expansions_v2 row and return its UUID."""
    from app.models.catalog_v2 import ExpansionV2
    existing = (
        session.query(ExpansionV2)
        .filter_by(game=GAME, external_id=set_info["external_id"])
        .first()
    )
    if existing:
        existing.name = set_info["name"]
        existing.last_synced_at = now
        session.flush()
        return existing.id

    row = ExpansionV2(
        id=uuid.uuid4(),
        external_id=set_info["external_id"],
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
    set_external_id: str,
) -> bool:
    """Upsert a cards_v2 row. Returns True if inserted, False if updated."""
    from app.models.catalog_v2 import CardV2

    # Resolve image URL — mirror to S3 if requested
    image_url = card.get("image_url")
    if s3 and image_url:
        mirrored = mirror_image(s3, image_url, set_external_id, card["external_id"])
        if mirrored:
            image_url = mirrored
            logger.info("    Mirrored image → %s", mirrored)

    images = {"small": image_url} if image_url else None

    # Include edition in name when present to distinguish 1st/unlimited prints
    display_name = card["name"]
    if card.get("edition"):
        display_name = f"{card['name']} ({card['edition']})"

    existing = (
        session.query(CardV2)
        .filter_by(game=GAME, external_id=card["external_id"])
        .first()
    )

    if existing:
        existing.name = display_name
        existing.printed_number = card.get("number")
        existing.rarity = card.get("rarity")
        existing.images = images
        existing.last_synced_at = now
        return False

    session.add(CardV2(
        id=uuid.uuid4(),
        external_id=card["external_id"],
        game=GAME,
        expansion_id=expansion_id,
        name=display_name,
        printed_number=card.get("number"),
        number=card.get("number"),
        rarity=card.get("rarity"),
        language=LANGUAGE,
        language_code=LANGUAGE_CODE,
        images=images,
        last_synced_at=now,
    ))
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest Naruto CCG cards from goatcardsshop")
    parser.add_argument("--dry-run", action="store_true", help="Scrape only, do not write to DB")
    parser.add_argument("--mirror-images", action="store_true", help="Download images and upload to S3")
    args = parser.parse_args()

    s3 = None
    if args.mirror_images:
        if not settings.aws_s3_bucket:
            logger.error("--mirror-images requires AWS_S3_BUCKET to be set in .env")
            sys.exit(1)
        s3 = _make_s3_client()
        logger.info("Image mirroring enabled → s3://%s/%s/", settings.aws_s3_bucket, S3_PREFIX)

    with httpx.Client() as client, Session(engine) as session:
        logger.info("=== Fetching set list from root category ===")
        sets = get_set_links(client)
        logger.info("Found %d sets\n", len(sets))

        total_inserted = 0
        total_updated = 0

        for set_info in sets:
            logger.info("--- Set: %s (id=%s) ---", set_info["name"], set_info["external_id"])
            cards = scrape_set(client, set_info)
            logger.info("  Scraped %d cards from %s", len(cards), set_info["name"])

            if args.dry_run:
                for c in cards[:3]:
                    logger.info("  [dry-run] %s", c)
                continue

            now = datetime.utcnow()
            expansion_id = upsert_expansion(session, set_info, now)

            inserted = updated = 0
            for card in cards:
                was_inserted = upsert_card(session, expansion_id, card, now, s3, set_info["external_id"])
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
