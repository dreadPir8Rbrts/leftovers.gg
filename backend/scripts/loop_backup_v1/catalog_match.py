"""
Fuzzy matching service: maps OCR-extracted card text to a card in the catalog.
Uses the existing GIN trigram index on cards.name for fast name search,
and rapidfuzz for re-ranking candidates.

All functions are synchronous (psycopg2/SQLAlchemy sync). Call from async
routes via asyncio.to_thread().
"""

from typing import Optional, Dict, Any, List

from rapidfuzz import fuzz, process
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.catalog import Card, Set, Serie


def match_card_from_ocr(ocr: Dict[str, Any], db: Session) -> Optional[Dict[str, Any]]:
    """
    Attempt to identify a card from OCR-extracted fields.
    Returns {"card": Card, "set": Set, "serie": Serie, "confidence": float, "method": str}
    or None if no confident match is found.

    Matching strategy (tries each tier, returns on first confident match):
      Tier 1: name + local_id exact match  → confidence 0.99
      Tier 2: local_id only (unique)       → confidence 0.90
      Tier 3: local_id + hp disambiguation  → confidence 0.88
      Tier 4: fuzzy name match             → confidence varies (min 0.80)
    """
    name: str = (ocr.get("name") or "").strip()
    set_number: str = (ocr.get("set_number") or "").strip()
    hp: Optional[int] = ocr.get("hp")

    local_id_variants = _local_id_variants(set_number) if set_number else []
    card_count = _parse_card_count(set_number) if set_number else None  # e.g. 131 from "029/131"

    # Tier 1: name + local_id (+ card_count to pin the set when multiple editions share the name/number)
    if name and local_id_variants:
        q = (
            db.query(Card, Set, Serie)
            .join(Set, Card.set_id == Set.id)
            .join(Serie, Set.serie_id == Serie.id)
            .filter(
                func.lower(Card.name) == name.lower(),
                Card.local_id.in_(local_id_variants),
            )
        )
        if card_count is not None:
            q = q.filter(Set.card_count_official == card_count)
        row = q.first()
        if row:
            return {"card": row[0], "set": row[1], "serie": row[2], "confidence": 0.99, "method": "exact"}

        # Retry Tier 1 without card_count filter in case card_count_official isn't populated
        if card_count is not None:
            row = (
                db.query(Card, Set, Serie)
                .join(Set, Card.set_id == Set.id)
                .join(Serie, Set.serie_id == Serie.id)
                .filter(
                    func.lower(Card.name) == name.lower(),
                    Card.local_id.in_(local_id_variants),
                )
                .first()
            )
            if row:
                return {"card": row[0], "set": row[1], "serie": row[2], "confidence": 0.95, "method": "exact_no_count"}

    # Tier 2 + 3: local_id only (+ card_count to narrow set), optionally disambiguate with HP
    if local_id_variants:
        q = (
            db.query(Card, Set, Serie)
            .join(Set, Card.set_id == Set.id)
            .join(Serie, Set.serie_id == Serie.id)
            .filter(Card.local_id.in_(local_id_variants))
        )
        if card_count is not None:
            q = q.filter(Set.card_count_official == card_count)
        rows = q.all()

        if len(rows) == 1:
            return {"card": rows[0][0], "set": rows[0][1], "serie": rows[0][2], "confidence": 0.90, "method": "local_id"}

        # Tier 2b: multiple cards share local_id — use fuzzy name to pick the best match.
        # Only fires when exactly one candidate scores >= 85 (clear winner). If two cards
        # have the same name (e.g. two printings of "Paras"), scores tie and we fall through
        # to HP disambiguation instead of returning an arbitrary result.
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
                    "set": rows[idx][1],
                    "serie": rows[idx][2],
                    "confidence": round(0.80 * score / 100, 2),
                    "method": "local_id_fuzzy_name",
                }

        if hp and rows:
            hp_matched = [r for r in rows if r[0].hp == hp]
            if len(hp_matched) == 1:
                return {"card": hp_matched[0][0], "set": hp_matched[0][1], "serie": hp_matched[0][2], "confidence": 0.88, "method": "local_id_hp"}

    # Tier 4: fuzzy name match
    if name and len(name) >= 3:
        rows = (
            db.query(Card, Set, Serie)
            .join(Set, Card.set_id == Set.id)
            .join(Serie, Set.serie_id == Serie.id)
            .filter(Card.name.ilike(f"%{name}%"))
            .limit(10)
            .all()
        )

        if rows:
            candidate_names = [r[0].name for r in rows]
            best = process.extractOne(name, candidate_names, scorer=fuzz.token_sort_ratio)
            if best and best[1] >= 80:
                idx = candidate_names.index(best[0])
                return {
                    "card": rows[idx][0],
                    "set": rows[idx][1],
                    "serie": rows[idx][2],
                    "confidence": round(best[1] / 100, 2),
                    "method": "fuzzy_name",
                }

    return None


def _parse_card_count(set_number: str) -> Optional[int]:
    """
    Extract the total card count from a set number string.
    '029/131'  -> 131
    '044/1910' -> 191  (OCR noise: 4th digit is a stray character, truncate to 3)
    'TG15/TG30' -> None (TG format doesn't map cleanly to card_count_official)
    """
    parts = set_number.split("/")
    if len(parts) < 2:
        return None
    second = parts[1]
    if second.upper().startswith("TG"):
        return None
    # Truncate 4-digit reads to 3 — OCR occasionally appends a stray character
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
