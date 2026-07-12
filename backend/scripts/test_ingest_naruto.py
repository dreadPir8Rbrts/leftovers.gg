"""Test Naruto CCG scraper — prints results to console without touching the DB.

Usage:
  cd backend
  python scripts/test_ingest_naruto.py              # scrape all sets
  python scripts/test_ingest_naruto.py --set 3886   # scrape one set by category ID
  python scripts/test_ingest_naruto.py --limit 2    # stop after N sets
"""

import argparse
import json
import sys

import httpx

sys.path.insert(0, ".")
from scripts.ingest_naruto_ccg import (
    BASE_URL,
    ROOT_CATEGORY,
    get_set_links,
    scrape_set,
)
from urllib.parse import urljoin


def main() -> None:
    parser = argparse.ArgumentParser(description="Test Naruto CCG scraper (no DB writes)")
    parser.add_argument("--set", dest="set_id", help="Only scrape the set with this category ID")
    parser.add_argument("--limit", type=int, help="Max number of sets to scrape")
    args = parser.parse_args()

    with httpx.Client() as client:
        print("=== Fetching set list ===")
        sets = get_set_links(client)
        print(f"Found {len(sets)} sets\n")

        if args.set_id:
            sets = [s for s in sets if s["external_id"] == args.set_id]
            if not sets:
                print(f"No set found with id={args.set_id}")
                return

        if args.limit:
            sets = sets[: args.limit]

        for set_info in sets:
            print(f"--- {set_info['name']}  (id={set_info['external_id']}) ---")
            cards = scrape_set(client, set_info)
            print(f"  {len(cards)} cards scraped\n")
            for card in cards:
                print(json.dumps(card, indent=2, default=str))
            print()


if __name__ == "__main__":
    main()
