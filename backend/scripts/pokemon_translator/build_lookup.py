"""
One-time script to build the PokéAPI Pokémon name lookup map (pokemon_names.json).

Fetches all Pokémon species from the PokéAPI and extracts both Japanese name variants
(ja = kanji/kana, ja-Hrkt = hiragana/katakana) mapping to the English name.

Usage:
    cd backend
    source .venv/bin/activate
    python -m scripts.pokemon_translator.build_lookup

Output:
    scripts/pokemon_translator/pokemon_names.json
"""

import asyncio
import json
import sys
from pathlib import Path

import httpx
from tqdm import tqdm

_HERE = Path(__file__).parent
_OUTPUT = _HERE / "pokemon_names.json"

POKEAPI_BASE = "https://pokeapi.co/api/v2"
CONCURRENCY = 20
MAX_RETRIES = 3


async def _fetch_json(client: httpx.AsyncClient, url: str, semaphore: asyncio.Semaphore) -> dict:
    async with semaphore:
        for attempt in range(MAX_RETRIES):
            try:
                resp = await client.get(url, timeout=15.0)
                resp.raise_for_status()
                return resp.json()
            except (httpx.HTTPError, httpx.TimeoutException) as e:
                if attempt == MAX_RETRIES - 1:
                    raise
                wait = 2 ** attempt
                await asyncio.sleep(wait)
    return {}


async def _build_map() -> dict:
    semaphore = asyncio.Semaphore(CONCURRENCY)
    name_map: dict = {}

    async with httpx.AsyncClient() as client:
        # Fetch species list
        print("Fetching species list from PokéAPI...")
        data = await _fetch_json(client, f"{POKEAPI_BASE}/pokemon-species?limit=10000", semaphore)
        species_urls = [entry["url"] for entry in data.get("results", [])]
        print(f"Found {len(species_urls)} species. Fetching name data...")

        # Fetch each species detail concurrently
        tasks = [_fetch_json(client, url, semaphore) for url in species_urls]
        for coro in tqdm(asyncio.as_completed(tasks), total=len(tasks), unit="species"):
            species = await coro
            en_name = next(
                (n["name"] for n in species.get("names", []) if n["language"]["name"] == "en"),
                None,
            )
            if not en_name:
                continue
            for lang in ("ja", "ja-Hrkt"):
                ja_name = next(
                    (n["name"] for n in species.get("names", []) if n["language"]["name"] == lang),
                    None,
                )
                if ja_name:
                    name_map[ja_name] = en_name

    return name_map


def main() -> None:
    name_map = asyncio.run(_build_map())
    _OUTPUT.write_text(json.dumps(name_map, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSaved {len(name_map)} JA→EN name mappings to {_OUTPUT}")


if __name__ == "__main__":
    main()
