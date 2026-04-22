"""
Dry-run translation test — prints EN translations for a sample of JA cards and expansions.
Does NOT write anything to the database.

Usage:
    cd backend
    source .venv/bin/activate
    python -m scripts.test_translate_sample
"""

import sys

import httpx

sys.path.insert(0, ".")

from app.db.session import SessionLocal, settings
from app.models.catalog_v2 import CardV2, ExpansionV2

TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2"
SAMPLE_SIZE = 20


def translate_batch(texts, api_key, source="ja"):
    resp = httpx.post(
        TRANSLATE_URL,
        params={"key": api_key},
        json={"q": texts, "source": source, "target": "en", "format": "text"},
        timeout=30.0,
    )
    resp.raise_for_status()
    return [t["translatedText"] for t in resp.json()["data"]["translations"]]


def main():
    api_key = settings.google_translate_api_key
    if not api_key:
        print("ERROR: GOOGLE_TRANSLATE_API_KEY not set in .env", file=sys.stderr)
        sys.exit(1)

    db = SessionLocal()
    try:
        expansions = (
            db.query(ExpansionV2)
            .filter(ExpansionV2.language_code == "JA")
            .limit(5)
            .all()
        )
        cards = (
            db.query(CardV2)
            .filter(CardV2.language_code == "JA")
            .limit(SAMPLE_SIZE)
            .all()
        )
    finally:
        db.close()

    if expansions:
        print(f"=== Expansions ({len(expansions)} sample) ===")
        translations = translate_batch([e.name for e in expansions], api_key)
        for exp, en in zip(expansions, translations):
            print(f"  {exp.name!r:40s} → {en!r}")

    print()

    if cards:
        print(f"=== Cards ({len(cards)} sample) ===")
        translations = translate_batch([c.name for c in cards], api_key)
        for card, en in zip(cards, translations):
            print(f"  {card.name!r:40s} → {en!r}")
    else:
        print("No JA cards found.")


if __name__ == "__main__":
    main()
