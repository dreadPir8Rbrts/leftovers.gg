"""Test v2 Naruto CCG ingestor — prints results to console without touching the DB.

Usage:
  cd backend
  python scripts/test_v2_ingest_naruto.py              # all sets
  python scripts/test_v2_ingest_naruto.py --set-id 882 # one set by Directus ID
  python scripts/test_v2_ingest_naruto.py --limit 2    # first N sets only
"""

import argparse
import json
import sys

import httpx

sys.path.insert(0, ".")
from scripts.v2_ingest_naruto import (
    fetch_sets,
    fetch_cards_for_set,
    _parse_reference,
    _image_url_from_card,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Test v2 Naruto CCG ingestor (no DB writes)")
    parser.add_argument("--set-id", type=int, help="Only fetch one set by Directus ID")
    parser.add_argument("--limit", type=int, help="Max number of sets to fetch")
    args = parser.parse_args()

    with httpx.Client() as client:
        print("=== Fetching set list ===")
        sets = fetch_sets(client)
        print(f"Found {len(sets)} sets\n")

        if args.set_id:
            sets = [s for s in sets if s["directus_id"] == args.set_id]
            if not sets:
                print(f"No set found with directus_id={args.set_id}")
                return

        if args.limit:
            sets = sets[: args.limit]

        for set_info in sets:
            print(f"--- {set_info['name']}  (id={set_info['directus_id']}, series={set_info['series_name']}) ---")
            cards = fetch_cards_for_set(client, set_info["directus_id"])
            print(f"  {len(cards)} cards\n")

            for card in cards:
                number, printed_number = _parse_reference(card.get("reference"))
                rarity_obj = card.get("rarity")
                rarity = rarity_obj["name"] if isinstance(rarity_obj, dict) else None
                image_url = _image_url_from_card(card)

                output = {
                    "external_id": str(card["id"]),
                    "name": card["name"],
                    "subtitle": card.get("subtitle"),
                    "type": card.get("type"),
                    "reference": card.get("reference"),
                    "number": number,
                    "printed_number": printed_number,
                    "rarity": rarity,
                    "image_url": image_url,
                    "set": set_info["name"],
                    "series": set_info["series_name"],
                }
                print(json.dumps(output, indent=2))
            print()


if __name__ == "__main__":
    main()
