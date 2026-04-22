"""
CLI entry point for the Pokémon TCG Japanese → English card name translator.

Modes:
  build-lookup  Build / refresh the PokéAPI name lookup map (pokemon_names.json).
  db            Translate all JA Pokémon cards in the DB missing en_name.
  file          Translate a flat text file of Japanese card names (one per line).

Usage:
    cd backend && source .venv/bin/activate

    # Step 1 — build the PokéAPI lookup map (run once)
    python -m scripts.pokemon_translator.main --mode build-lookup

    # Step 2 — preview 20 cards without writing
    python -m scripts.pokemon_translator.main --mode db --dry-run --limit 20

    # Step 3 — process all JA cards
    python -m scripts.pokemon_translator.main --mode db

    # Translate a text file
    python -m scripts.pokemon_translator.main --mode file --input cards.txt --output results.csv
"""

import argparse
import csv
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # backend/ root

from app.db.session import SessionLocal
from app.models.catalog_v2 import CardV2, ExpansionV2

from .build_lookup import main as run_build_lookup
from .parser import parse_card_name
from .reconstructor import reconstruct_english_name
from .translator import load_pokemon_map, load_trainer_map, translate_card


def _process_db(dry_run: bool, limit: Optional[int], no_fallback: bool) -> None:
    pokemon_map = load_pokemon_map()
    trainer_map = load_trainer_map()

    db = SessionLocal()
    try:
        query = (
            db.query(CardV2, ExpansionV2)
            .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
            .filter(
                CardV2.game == "pokemon",
                CardV2.language_code == "JA",
                CardV2.en_name.is_(None),
            )
        )
        if limit:
            query = query.limit(limit)
        rows = query.all()

        print(f"Cards to process: {len(rows)}")

        stats = {"map": 0, "claude": 0, "trainer_map": 0, "passthrough": 0, "unresolved": 0}
        batch: list = []

        for i, (card, expansion) in enumerate(rows):
            parsed = parse_card_name(card.name, card.supertype)
            translated = translate_card(
                parsed,
                pokemon_map,
                trainer_map,
                set_name=expansion.name,
                no_fallback=no_fallback,
            )
            en_name = reconstruct_english_name(translated)
            resolved_by = translated["resolved_by"]
            stats[resolved_by] = stats.get(resolved_by, 0) + 1

            if dry_run:
                print(f"  [{resolved_by:12s}] {card.name!r:40s} → {en_name!r}")
            else:
                if en_name:
                    card.en_name = en_name
                    batch.append(card)
                if (i + 1) % 500 == 0:
                    print(f"  {i + 1}/{len(rows)} processed (claude={stats.get('claude', 0)} unresolved={stats.get('unresolved', 0)})", flush=True)

            if not dry_run and len(batch) >= 100:
                db.commit()
                batch.clear()

        if not dry_run and batch:
            db.commit()

    finally:
        db.close()

    print(f"\nTotal processed : {sum(stats.values())}")
    print(f"Map hits        : {stats.get('map', 0)}")
    print(f"Trainer map hits: {stats.get('trainer_map', 0)}")
    print(f"Pass-through    : {stats.get('passthrough', 0)}")
    print(f"Claude hits     : {stats.get('claude', 0)}")
    print(f"Unresolved      : {stats.get('unresolved', 0)}")


def _process_file(input_path: str, output_path: str, no_fallback: bool) -> None:
    pokemon_map = load_pokemon_map()
    trainer_map = load_trainer_map()

    lines = Path(input_path).read_text(encoding="utf-8").splitlines()
    results = []

    for line in lines:
        name = line.strip()
        if not name:
            continue
        parsed = parse_card_name(name, supertype=None)
        translated = translate_card(parsed, pokemon_map, trainer_map, no_fallback=no_fallback)
        en_name = reconstruct_english_name(translated)
        results.append({"japanese_name": name, "en_name": en_name or ""})
        print(f"  {name!r:40s} → {en_name!r}")

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["japanese_name", "en_name"])
        writer.writeheader()
        writer.writerows(results)

    print(f"\nWrote {len(results)} rows to {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Pokémon TCG JA→EN name translator")
    parser.add_argument(
        "--mode",
        choices=["db", "file", "build-lookup"],
        required=True,
        help="Operation mode",
    )
    parser.add_argument("--input", help="Input .txt file (one JA name per line) — mode=file only")
    parser.add_argument("--output", default="results.csv", help="Output .csv path — mode=file only")
    parser.add_argument("--dry-run", action="store_true", help="Print without writing to DB")
    parser.add_argument("--no-fallback", action="store_true", help="Disable Claude API fallback")
    parser.add_argument("--limit", type=int, default=None, help="Max cards to process")
    args = parser.parse_args()

    if args.mode == "build-lookup":
        run_build_lookup()
    elif args.mode == "db":
        if args.dry_run:
            print("DRY RUN — no DB writes.\n")
        _process_db(dry_run=args.dry_run, limit=args.limit, no_fallback=args.no_fallback)
    elif args.mode == "file":
        if not args.input:
            print("ERROR: --input is required for --mode file", file=sys.stderr)
            sys.exit(1)
        _process_file(args.input, args.output, no_fallback=args.no_fallback)


if __name__ == "__main__":
    main()
