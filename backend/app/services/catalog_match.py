"""
Fuzzy matching service: maps OCR-extracted card text to a card in cards_v2.

Pokémon-only (game='pokemon') — all queries filter on game to avoid cross-game
collisions. One Piece scan support is deferred to a future iteration.

All functions are synchronous (psycopg2/SQLAlchemy sync). Call from async
routes via asyncio.to_thread().

Returns dicts with keys: card (CardV2), expansion (ExpansionV2), confidence (float), method (str).
"""

from typing import Optional, Dict, Any, List

from rapidfuzz import fuzz, process
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.catalog_v2 import CardV2, ExpansionV2


def match_card_from_ocr(ocr: Dict[str, Any], db: Session) -> Optional[Dict[str, Any]]:
    """
    Attempt to identify a Pokémon card from OCR-extracted fields.
    Returns {"card": CardV2, "expansion": ExpansionV2, "confidence": float, "method": str}
    or None if no confident match is found.

    Matching strategy (tries each tier, returns on first confident match):
      Tier 1: name + local_id exact match  → confidence 0.99
      Tier 2: local_id only (unique)       → confidence 0.90
      Tier 3: local_id + hp disambiguation → confidence 0.88
      Tier 4: fuzzy name match             → confidence varies (min 0.80)
    """
    name: str = (ocr.get("name") or "").strip()
    set_number: str = (ocr.get("set_number") or "").strip()
    hp: Optional[int] = ocr.get("hp")

    local_id_variants = _local_id_variants(set_number) if set_number else []
    card_count = _parse_card_count(set_number) if set_number else None  # e.g. 131 from "029/131"

    # Tier 1: name + local_id (+ card_count to pin the expansion when multiple editions share the name/number)
    if name and local_id_variants:
        q = (
            db.query(CardV2, ExpansionV2)
            .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
            .filter(
                func.lower(CardV2.name) == name.lower(),
                CardV2.number.in_(local_id_variants),
                CardV2.game == "pokemon",
            )
        )
        if card_count is not None:
            q = q.filter(ExpansionV2.total == card_count)
        row = q.first()
        if row:
            return {"card": row[0], "expansion": row[1], "confidence": 0.99, "method": "exact"}

        # Retry Tier 1 without card_count filter in case total isn't populated
        if card_count is not None:
            row = (
                db.query(CardV2, ExpansionV2)
                .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
                .filter(
                    func.lower(CardV2.name) == name.lower(),
                    CardV2.number.in_(local_id_variants),
                    CardV2.game == "pokemon",
                )
                .first()
            )
            if row:
                return {"card": row[0], "expansion": row[1], "confidence": 0.95, "method": "exact_no_count"}

    # Tier 2 + 3: local_id only (+ card_count to narrow expansion), optionally disambiguate with HP
    if local_id_variants:
        q = (
            db.query(CardV2, ExpansionV2)
            .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
            .filter(
                CardV2.number.in_(local_id_variants),
                CardV2.game == "pokemon",
            )
        )
        if card_count is not None:
            q = q.filter(ExpansionV2.total == card_count)
        rows = q.all()

        if len(rows) == 1:
            return {"card": rows[0][0], "expansion": rows[0][1], "confidence": 0.90, "method": "local_id"}

        # Tier 2b: multiple cards share local_id — use fuzzy name to pick the best match.
        if name and len(rows) > 1:
            scored: List[tuple] = [
                (i, fuzz.token_sort_ratio(name, r[0].name))
                for i, r in enumerate(rows)
            ]
            high: List[tuple] = [(i, s) for i, s in scored if s >= 85]
            if len(high) == 1:
                idx, score = high[0]
                return {
                    "card": rows[idx][0],
                    "expansion": rows[idx][1],
                    "confidence": round(0.80 * score / 100, 2),
                    "method": "local_id_fuzzy_name",
                }

        if hp and rows:
            hp_matched = [r for r in rows if r[0].hp == str(hp)]
            if len(hp_matched) == 1:
                return {"card": hp_matched[0][0], "expansion": hp_matched[0][1], "confidence": 0.88, "method": "local_id_hp"}

    # Tier 4: fuzzy name match
    if name and len(name) >= 3:
        rows = (
            db.query(CardV2, ExpansionV2)
            .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
            .filter(
                CardV2.name.ilike(f"%{name}%"),
                CardV2.game == "pokemon",
            )
            .limit(50)
            .all()
        )

        if rows:
            candidate_names = [r[0].name for r in rows]
            best = process.extractOne(name, candidate_names, scorer=fuzz.token_sort_ratio)
            if best and best[1] >= 80:
                best_score = best[1]
                top_candidates: List[tuple] = [
                    (i, fuzz.token_sort_ratio(name, r[0].name), r)
                    for i, r in enumerate(rows)
                    if fuzz.token_sort_ratio(name, r[0].name) >= best_score - 5
                ]

                if len(top_candidates) == 1:
                    idx, score, _ = top_candidates[0]
                    return {
                        "card": rows[idx][0],
                        "expansion": rows[idx][1],
                        "confidence": round(score / 100, 2),
                        "method": "fuzzy_name",
                    }

                # Multiple candidates — use HP to disambiguate
                if hp is not None:
                    hp_top: List[tuple] = [
                        (i, score, r) for i, score, r in top_candidates if r[0].hp == str(hp)
                    ]
                    if len(hp_top) == 1:
                        idx, score, _ = hp_top[0]
                        return {
                            "card": rows[idx][0],
                            "expansion": rows[idx][1],
                            "confidence": round(min(score / 100 + 0.05, 0.99), 2),
                            "method": "fuzzy_name_hp",
                        }
                    if len(hp_top) > 1:
                        hp_top_sorted = sorted(hp_top, key=lambda x: x[1], reverse=True)
                        idx, score, _ = hp_top_sorted[0]
                        return {
                            "card": rows[idx][0],
                            "expansion": rows[idx][1],
                            "confidence": round(score / 100, 2),
                            "method": "fuzzy_name_hp_best",
                        }

                # No HP or HP didn't help — pick highest scorer
                top_candidates_sorted = sorted(top_candidates, key=lambda x: x[1], reverse=True)
                idx, score, _ = top_candidates_sorted[0]
                return {
                    "card": rows[idx][0],
                    "expansion": rows[idx][1],
                    "confidence": round(score / 100, 2),
                    "method": "fuzzy_name",
                }

    return None


def _parse_card_count(set_number: str) -> Optional[int]:
    """
    Extract the total card count from a set number string.
    '029/131'  -> 131
    '044/1910' -> 191  (OCR noise: 4th digit is a stray character, truncate to 3)
    'TG15/TG30' -> None (TG format doesn't map cleanly to expansion total)
    """
    parts = set_number.split("/")
    if len(parts) < 2:
        return None
    second = parts[1]
    if second.upper().startswith("TG"):
        return None
    if len(second) == 4 and second.isdigit():
        second = second[:3]
    return int(second) if second.isdigit() else None


def _local_id_variants(set_number: str) -> List[str]:
    """
    Return both the raw and leading-zero-stripped form of a set number's local ID.
    '006/091' -> ['006', '6']
    'TG15/TG30' -> ['TG15']
    Deduplicated so exact matches don't produce duplicates.
    """
    part = set_number.split("/")[0]
    if part.upper().startswith("TG"):
        return [part.upper()]
    stripped = str(int(part)) if part.isdigit() else part
    return list(dict.fromkeys([part, stripped]))  # preserve order, deduplicate
