"""
Backfill en_name on cards_v2 and name_en on expansions_v2 for all non-English rows.

Uses the Google Cloud Translation REST API to translate card and expansion names
from their native language to English. Results are stored in en_name / name_en
so that the smart-search endpoint (/cards/search) can match English-language
queries against non-English catalog entries.

Usage:
    cd backend
    source .venv/bin/activate
    python -m scripts.backfill_en_names [--dry-run] [--language-code JA]

Options:
    --dry-run        Print what would be translated without writing to DB.
    --language-code  Only process rows with this language_code (default: JA).
                     Pass multiple times for multiple codes.

Requirements:
    GOOGLE_TRANSLATE_API_KEY must be set in backend/.env.
    Run `alembic upgrade head` (migration 0028) before this script.
"""

import argparse
import sys
import time
from typing import List, Optional

import httpx
from sqlalchemy.orm import Session

sys.path.insert(0, ".")  # run from backend/ root

from app.db.session import SessionLocal, settings
from app.models.catalog_v2 import CardV2, ExpansionV2

TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2"
BATCH_SIZE = 100  # Google Translate supports up to 128 segments per request


def translate_batch(texts: List[str], api_key: str, source: str = "ja") -> List[str]:
    """Translate a batch of texts from `source` to English via Google Translate REST API."""
    resp = httpx.post(
        TRANSLATE_URL,
        params={"key": api_key},
        json={"q": texts, "source": source, "target": "en", "format": "text"},
        timeout=30.0,
    )
    resp.raise_for_status()
    data = resp.json()
    return [t["translatedText"] for t in data["data"]["translations"]]


def backfill_expansions(
    db: Session,
    api_key: str,
    language_codes: List[str],
    dry_run: bool,
) -> int:
    rows = (
        db.query(ExpansionV2)
        .filter(
            ExpansionV2.language_code.in_(language_codes),
            ExpansionV2.name_en.is_(None),
        )
        .all()
    )
    print(f"  {len(rows)} expansion(s) need name_en")
    if not rows:
        return 0

    updated = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        names = [r.name for r in batch]
        translations = translate_batch(names, api_key)
        for row, en in zip(batch, translations):
            print(f"    [{row.language_code}] {row.name!r} → {en!r}")
            if not dry_run:
                row.name_en = en
                updated += 1
        if not dry_run:
            db.commit()
        time.sleep(0.2)  # stay well under quota

    return updated


def backfill_cards(
    db: Session,
    api_key: str,
    language_codes: List[str],
    dry_run: bool,
) -> int:
    rows = (
        db.query(CardV2)
        .filter(
            CardV2.language_code.in_(language_codes),
            CardV2.en_name.is_(None),
        )
        .all()
    )
    print(f"  {len(rows)} card(s) need en_name")
    if not rows:
        return 0

    updated = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        names = [r.name for r in batch]
        translations = translate_batch(names, api_key)
        for row, en in zip(batch, translations):
            if row.name != en:  # skip if translation is identical (already English)
                row.en_name = en
                updated += 1
        if not dry_run:
            db.commit()
        if i % 1000 == 0 and i > 0:
            print(f"    ...{i} cards processed")
        time.sleep(0.2)

    return updated


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill en_name / name_en via Google Translate")
    parser.add_argument("--dry-run", action="store_true", help="Print without writing to DB")
    parser.add_argument(
        "--language-code",
        action="append",
        dest="language_codes",
        default=[],
        metavar="CODE",
        help="Language code(s) to process (default: JA)",
    )
    args = parser.parse_args()

    language_codes: List[str] = args.language_codes or ["JA"]

    api_key: Optional[str] = settings.google_translate_api_key
    if not api_key:
        print("ERROR: GOOGLE_TRANSLATE_API_KEY is not set in .env", file=sys.stderr)
        sys.exit(1)

    if args.dry_run:
        print("DRY RUN — no changes will be written.\n")

    db = SessionLocal()
    try:
        print(f"Processing language codes: {language_codes}")

        print("\n--- Expansions ---")
        exp_count = backfill_expansions(db, api_key, language_codes, args.dry_run)

        print("\n--- Cards ---")
        card_count = backfill_cards(db, api_key, language_codes, args.dry_run)

        print(f"\nDone. expansions updated={exp_count}  cards updated={card_count}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
