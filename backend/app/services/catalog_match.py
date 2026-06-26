"""
Fuzzy matching service: maps OCR-extracted card text to a card in cards_v2.

Pokémon-only (game='pokemon') — all queries filter on game to avoid cross-game
collisions. One Piece scan support is deferred to a future iteration.

All functions are synchronous (psycopg2/SQLAlchemy sync). Call from async
routes via asyncio.to_thread().

Returns dicts with keys: card (CardV2), expansion (ExpansionV2), confidence (float), method (str).
"""

import unicodedata
from typing import Optional, Dict, Any, List

from rapidfuzz import fuzz, process
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models.catalog_v2 import CardV2, ExpansionV2


def _strip_accents(s: str) -> str:
    """Strip Latin diacritics (é→e) without touching other scripts.
    Only removes Mn characters in U+0300–U+036F (Latin Combining Diacritical Marks).
    Japanese voiced kana (グ, ダ, ボ…) decompose to base+U+3099/U+309A in NFD;
    those marks are outside the Latin range and are preserved, then re-composed to NFC."""
    stripped = "".join(
        c for c in unicodedata.normalize("NFD", s)
        if not (unicodedata.category(c) == "Mn" and 0x0300 <= ord(c) <= 0x036F)
    )
    return unicodedata.normalize("NFC", stripped)


def _count_filter(q: Any, count: int) -> Any:
    """Filter a query by card count against both total and printed_total (either may be NULL)."""
    return q.filter(or_(ExpansionV2.total == count, ExpansionV2.printed_total == count))


def _number_format(set_number: str) -> Optional[str]:
    """Detect the printed format of an OCR-extracted card number.
    'No.141' → 'no_prefix'; '141/165' → 'slash'; bare number → None.
    Used to disambiguate same-name/same-number cards from different eras.
    """
    if set_number.upper().startswith("NO."):
        return "no_prefix"
    if "/" in set_number:
        return "slash"
    return None


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
    lang_code: Optional[str] = (ocr.get("language_code") or "").upper().strip() or None
    tier2_candidates: List[tuple] = []  # populated when Tier 2 finds rows but can't disambiguate

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
        if lang_code:
            q = q.filter(CardV2.language_code == lang_code)
        if card_count is not None:
            q = _count_filter(q, card_count)
        t1_rows = q.all()

        # Retry without card_count if empty — total/printed_total may be NULL
        no_count_retry = False
        if not t1_rows and card_count is not None:
            q2 = (
                db.query(CardV2, ExpansionV2)
                .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
                .filter(
                    func.lower(CardV2.name) == name.lower(),
                    CardV2.number.in_(local_id_variants),
                    CardV2.game == "pokemon",
                )
            )
            if lang_code:
                q2 = q2.filter(CardV2.language_code == lang_code)
            t1_rows = q2.all()
            no_count_retry = True

        if len(t1_rows) == 1:
            conf = 0.95 if no_count_retry else 0.99
            method = "exact_no_count" if no_count_retry else "exact"
            return {"card": t1_rows[0][0], "expansion": t1_rows[0][1], "confidence": conf, "method": method}

        if len(t1_rows) > 1 and set_number:
            # Multiple cards share name + number (different sets/eras). Use the printed_number
            # format to disambiguate: OCR "No.141" should prefer printed_number="No.141"
            # over printed_number="141/165", and vice versa.
            fmt = _number_format(set_number)
            if fmt == "no_prefix":
                fmt_rows = [r for r in t1_rows if r[0].printed_number and r[0].printed_number.upper().startswith("NO.")]
            elif fmt == "slash":
                fmt_rows = [r for r in t1_rows if r[0].printed_number and "/" in r[0].printed_number]
            else:
                fmt_rows = []
            if len(fmt_rows) == 1:
                return {"card": fmt_rows[0][0], "expansion": fmt_rows[0][1], "confidence": 0.97, "method": "exact_printed_num"}
            # Still ambiguous — fall through to lower tiers

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
        if lang_code:
            q = q.filter(CardV2.language_code == lang_code)
        if card_count is not None:
            q = _count_filter(q, card_count)
        rows = q.all()

        # Retry Tier 2 without card_count if neither total nor printed_total matched
        if not rows and card_count is not None:
            q2 = (
                db.query(CardV2, ExpansionV2)
                .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
                .filter(
                    CardV2.number.in_(local_id_variants),
                    CardV2.game == "pokemon",
                )
            )
            if lang_code:
                q2 = q2.filter(CardV2.language_code == lang_code)
            rows = q2.all()

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
                # Guard: HP alone can match an unrelated card that shares the number.
                # Require a reasonable name similarity when name is available.
                name_score = fuzz.token_sort_ratio(name, hp_matched[0][0].name) if name else 100
                if name_score >= 70:
                    return {"card": hp_matched[0][0], "expansion": hp_matched[0][1], "confidence": 0.88, "method": "local_id_hp"}

        # Multiple rows remain after all Tier 2 disambiguation — save for fallback.
        # If Tier 4 also fails, these will be surfaced as ambiguous candidates.
        if len(rows) > 1:
            tier2_candidates = rows

    # If Tier 2 found multiple candidates, narrow to name-matching ones before Tier 4.
    # Returning only name-matched ambiguous results is more honest than letting Tier 4's
    # HP filter pick a wrong card (e.g. vending series cards have null HP in the DB,
    # so a different card with a matching HP value would win incorrectly).
    if tier2_candidates and name:
        name_matched = [r for r in tier2_candidates if fuzz.token_sort_ratio(name, r[0].name) >= 95]
        if name_matched:
            return {
                "ambiguous": True,
                "candidates": [{"card": r[0], "expansion": r[1]} for r in name_matched],
            }

    # Tier 4: fuzzy name match — unaccent on both sides so "POKEMON MACHINE" finds "Pokémon Machine"
    if name and len(name) >= 3:
        norm_name = _strip_accents(name)
        t4_q = (
            db.query(CardV2, ExpansionV2)
            .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
            .filter(
                or_(
                    func.unaccent(CardV2.name).ilike(f"%{norm_name}%"),
                    func.unaccent(CardV2.en_name).ilike(f"%{norm_name}%"),
                ),
                CardV2.game == "pokemon",
            )
        )
        if lang_code:
            t4_q = t4_q.filter(CardV2.language_code == lang_code)
        rows = t4_q.limit(50).all()

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

    # All tiers exhausted. If Tier 2 had multiple candidates that couldn't be
    # disambiguated by name/HP, surface them so the caller can ask the user.
    if tier2_candidates:
        return {
            "ambiguous": True,
            "candidates": [{"card": r[0], "expansion": r[1]} for r in tier2_candidates],
        }

    return None


def match_card_from_ocr_v2(ocr: Dict[str, Any], db: Session) -> Optional[Dict[str, Any]]:
    """
    Name-primary matching strategy (Quick Scan v2).

    Tier 1: exact name + number match
      - 0 results → fall through to Tier 2
      - 1 result  → return (confidence 0.99)
      - >1 results → printed_number disambiguation; if still >1 → AMBIGUOUS immediately
        (never falls through to number-only search, which pulls in unrelated cards)

    Tier 2: name-primary fuzzy, then narrow by number
      - finds all cards matching the name (fuzzy)
      - if number available → filter name pool by number
        - 1 result → return (0.97); >1 → ambiguous
      - if no number (or number produced no results) → HP or top matches as ambiguous

    Tier 3: number only (last resort — name completely unreadable)
      - HP disambiguation requires name agreement (≥70 fuzzy score)
    """
    name: str = (ocr.get("name") or "").strip()
    set_number: str = (ocr.get("set_number") or "").strip()
    hp: Optional[int] = ocr.get("hp")
    lang_code: Optional[str] = (ocr.get("language_code") or "").upper().strip() or None

    local_id_variants = _local_id_variants(set_number) if set_number else []
    card_count = _parse_card_count(set_number) if set_number else None

    # ------------------------------------------------------------------
    # Tier 1: exact name + number
    # ------------------------------------------------------------------
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
        if lang_code:
            q = q.filter(CardV2.language_code == lang_code)
        if card_count is not None:
            q = _count_filter(q, card_count)
        t1_rows = q.all()

        if not t1_rows and card_count is not None:
            q2 = (
                db.query(CardV2, ExpansionV2)
                .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
                .filter(
                    func.lower(CardV2.name) == name.lower(),
                    CardV2.number.in_(local_id_variants),
                    CardV2.game == "pokemon",
                )
            )
            if lang_code:
                q2 = q2.filter(CardV2.language_code == lang_code)
            t1_rows = q2.all()

        if len(t1_rows) == 1:
            return {"card": t1_rows[0][0], "expansion": t1_rows[0][1], "confidence": 0.99, "method": "v2_exact"}

        if len(t1_rows) > 1:
            fmt = _number_format(set_number)
            if fmt == "no_prefix":
                fmt_rows = [r for r in t1_rows if r[0].printed_number and r[0].printed_number.upper().startswith("NO.")]
            elif fmt == "slash":
                fmt_rows = [r for r in t1_rows if r[0].printed_number and "/" in r[0].printed_number]
            else:
                fmt_rows = []
            if len(fmt_rows) == 1:
                return {"card": fmt_rows[0][0], "expansion": fmt_rows[0][1], "confidence": 0.97, "method": "v2_exact_printed_num"}
            # Still ambiguous — return immediately rather than falling to number-only search
            candidates = fmt_rows if len(fmt_rows) > 1 else t1_rows
            return {"ambiguous": True, "candidates": [{"card": r[0], "expansion": r[1]} for r in candidates]}

    # ------------------------------------------------------------------
    # Tier 2: name-primary fuzzy, then narrow by number
    # ------------------------------------------------------------------
    if name and len(name) >= 2:
        norm_name = _strip_accents(name)
        q = (
            db.query(CardV2, ExpansionV2)
            .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
            .filter(
                or_(
                    func.unaccent(CardV2.name).ilike(f"%{norm_name}%"),
                    func.unaccent(CardV2.en_name).ilike(f"%{norm_name}%"),
                ),
                CardV2.game == "pokemon",
            )
        )
        if lang_code:
            q = q.filter(CardV2.language_code == lang_code)
        name_rows = q.limit(100).all()

        if name_rows:
            scored = sorted(
                [(r, fuzz.token_sort_ratio(name, r[0].name)) for r in name_rows],
                key=lambda x: x[1],
                reverse=True,
            )
            best_score = scored[0][1]

            if best_score >= 75:
                top: List[tuple] = [r for r, s in scored if s >= best_score - 5]

                if local_id_variants:
                    number_top = [r for r in top if r[0].number in local_id_variants]
                    if len(number_top) == 1:
                        return {
                            "card": number_top[0][0],
                            "expansion": number_top[0][1],
                            "confidence": round(best_score / 100 * 0.97, 2),
                            "method": "v2_name_number",
                        }
                    if len(number_top) > 1:
                        return {"ambiguous": True, "candidates": [{"card": r[0], "expansion": r[1]} for r in number_top]}
                    # Number filter removed all candidates — try en_name bridge before
                    # falling back to name-only. Handles JA cards where the name field
                    # stores the English name (data inconsistency in some imported sets,
                    # e.g. sv6a_ja). The name-matched candidates share the same en_name
                    # (e.g. 'Horsea'), so we search JA cards by en_name + number to find
                    # the card that couldn't be reached by direct name search.
                    en_names = list({r[0].en_name for r in top if r[0].en_name})
                    if en_names:
                        fb_q = (
                            db.query(CardV2, ExpansionV2)
                            .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
                            .filter(
                                CardV2.en_name.in_(en_names),
                                CardV2.number.in_(local_id_variants),
                                CardV2.game == "pokemon",
                            )
                        )
                        if lang_code:
                            fb_q = fb_q.filter(CardV2.language_code == lang_code)
                        fb_rows = fb_q.all()
                        if len(fb_rows) == 1:
                            return {
                                "card": fb_rows[0][0],
                                "expansion": fb_rows[0][1],
                                "confidence": round(best_score / 100 * 0.88, 2),
                                "method": "v2_name_en_bridge",
                            }
                        if len(fb_rows) > 1:
                            return {
                                "ambiguous": True,
                                "candidates": [{"card": r[0], "expansion": r[1]} for r in fb_rows],
                            }

                if len(top) == 1:
                    return {
                        "card": top[0][0],
                        "expansion": top[0][1],
                        "confidence": round(best_score / 100, 2),
                        "method": "v2_name_only",
                    }

                if hp is not None:
                    hp_top_t2 = [r for r in top if r[0].hp == str(hp)]
                    if len(hp_top_t2) == 1:
                        return {
                            "card": hp_top_t2[0][0],
                            "expansion": hp_top_t2[0][1],
                            "confidence": round(best_score / 100 * 0.92, 2),
                            "method": "v2_name_hp",
                        }

                return {"ambiguous": True, "candidates": [{"card": r[0], "expansion": r[1]} for r in top[:10]]}

    # ------------------------------------------------------------------
    # Tier 3: number only (last resort)
    # ------------------------------------------------------------------
    if local_id_variants:
        q = (
            db.query(CardV2, ExpansionV2)
            .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
            .filter(CardV2.number.in_(local_id_variants), CardV2.game == "pokemon")
        )
        if lang_code:
            q = q.filter(CardV2.language_code == lang_code)
        if card_count is not None:
            q = _count_filter(q, card_count)
        rows = q.all()

        if not rows and card_count is not None:
            q2 = (
                db.query(CardV2, ExpansionV2)
                .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
                .filter(CardV2.number.in_(local_id_variants), CardV2.game == "pokemon")
            )
            if lang_code:
                q2 = q2.filter(CardV2.language_code == lang_code)
            rows = q2.all()

        if len(rows) == 1:
            return {"card": rows[0][0], "expansion": rows[0][1], "confidence": 0.65, "method": "v2_number_only"}

        if rows:
            if hp is not None:
                hp_matched = [r for r in rows if r[0].hp == str(hp)]
                if len(hp_matched) == 1:
                    name_score = fuzz.token_sort_ratio(name, hp_matched[0][0].name) if name else 100
                    if name_score >= 70:
                        return {"card": hp_matched[0][0], "expansion": hp_matched[0][1], "confidence": 0.70, "method": "v2_number_hp"}
            return {"ambiguous": True, "candidates": [{"card": r[0], "expansion": r[1]} for r in rows[:10]]}

    return None


def _best_name_score(card: CardV2, name_candidates: List[str]) -> int:
    """Score a card against all OCR name candidates; return the highest score.

    Uses max(ratio, token_sort_ratio) per candidate:
    - token_sort_ratio handles reordered tokens (e.g. OCR reads "Pikachu BASIC" vs DB "BASIC Pikachu")
    - ratio handles merged tokens (e.g. OCR reads "イマクニ?のドードー" vs DB "イマクニ? のドードー"
      where the space causes token_sort to rearrange to "のドードー イマクニ?", tanking the score)
    """
    best = 0
    for candidate in name_candidates:
        c = candidate.lower()
        db_name = (card.name or "").lower()
        s = max(fuzz.ratio(c, db_name), fuzz.token_sort_ratio(c, db_name))
        if card.en_name:
            en = card.en_name.lower()
            s = max(s, fuzz.ratio(c, en), fuzz.token_sort_ratio(c, en))
        best = max(best, s)
    return best


def _filter_by_name(
    rows: List[tuple], name_candidates: List[str], gap: int = 10
) -> List[tuple]:
    """Return only the rows whose name score is within `gap` of the best scorer.
    Drops partial-match contamination (e.g. 'キョウのモンジャラ' scoring ~80%
    when 'モンジャラ' scores 100%) from ambiguous candidate lists.
    If name_candidates is empty or all rows score 0, returns rows unchanged."""
    if not name_candidates or not rows:
        return rows
    scored = [(r, _best_name_score(r[0], name_candidates)) for r in rows]
    top = max(s for _, s in scored)
    if top == 0:
        return rows
    return [r for r, s in scored if s >= top - gap]


def _is_bare_number(set_number: str) -> bool:
    """True for bare card numbers with no format indicator: '085', '007'.
    False for slash ('063/182'), No-prefix ('No.036'), and promo ('064/SV-P') formats."""
    if not set_number:
        return True
    return "/" not in set_number and not set_number.upper().startswith("NO.")


def _v3_disambiguate(
    rows: List[tuple],
    name_candidates: List[str],
    illustrator: str,
    hp: Optional[int],
    method_prefix: str,
) -> Optional[Dict[str, Any]]:
    """Try HP-elimination → artist → name_candidates → HP-positive to pick one row.
    Returns a match dict or None if still ambiguous."""

    # 0. HP negative elimination — remove candidates whose DB hp is known (non-null)
    #    and contradicts the OCR hp. null DB hp is inconclusive (vending/vintage cards
    #    often lack hp data), so only a confirmed mismatch eliminates.
    #
    #    Guard: only run elimination when at least one candidate *confirms* the OCR HP
    #    (i.e. has hp == str(ocr_hp)). If no candidate confirms it, the OCR reading is
    #    probably wrong (e.g. "LV.15 HP 50" misread as hp=15) — skip elimination to
    #    avoid incorrectly narrowing to surviving null-HP cards.
    working = rows
    if hp is not None:
        confirmed = [r for r in rows if r[0].hp == str(hp)]
        if confirmed:
            surviving = [r for r in rows if r[0].hp is None or r[0].hp == str(hp)]
            if 0 < len(surviving) < len(rows):
                if len(surviving) == 1:
                    return {
                        "card": surviving[0][0],
                        "expansion": surviving[0][1],
                        "confidence": 0.90,
                        "method": f"{method_prefix}_hp_elim",
                    }
                working = surviving

    # 1. Artist fuzzy (unique match scoring ≥ 85)
    if illustrator:
        artist_scored = [
            (r, fuzz.ratio(illustrator.lower(), (r[0].artist or "").lower()))
            for r in working
        ]
        artist_top = [(r, s) for r, s in artist_scored if s >= 85]
        if len(artist_top) == 1:
            r, score = artist_top[0]
            return {
                "card": r[0],
                "expansion": r[1],
                "confidence": round(score / 100 * 0.97, 2),
                "method": f"{method_prefix}_artist",
            }

    # 2. Name candidates — score each row against all candidates, take max per row.
    #    Only auto-picks when there is a single uniquely best candidate; does NOT
    #    auto-pick on a perfect-score tie (e.g. two cards with the same name both
    #    scoring 100% would previously be incorrectly resolved by this step).
    if name_candidates:
        name_scored = sorted(
            [(r, _best_name_score(r[0], name_candidates)) for r in working],
            key=lambda x: x[1],
            reverse=True,
        )
        top_score = name_scored[0][1] if name_scored else 0
        if top_score >= 80:
            close = [r for r, s in name_scored if s >= top_score - 5]
            if len(close) == 1:
                r = name_scored[0][0]
                return {
                    "card": r[0],
                    "expansion": r[1],
                    "confidence": round(top_score / 100 * 0.95, 2),
                    "method": f"{method_prefix}_name",
                }

    # 3. HP positive — pick the single candidate whose HP matches OCR
    if hp is not None:
        hp_matched = [r for r in working if r[0].hp == str(hp)]
        if len(hp_matched) == 1:
            return {
                "card": hp_matched[0][0],
                "expansion": hp_matched[0][1],
                "confidence": 0.82,
                "method": f"{method_prefix}_hp",
            }

    return None


def match_card_v3(ocr: Dict[str, Any], db: Session) -> Optional[Dict[str, Any]]:
    """
    Quick Scan v3: printed_number-primary matching strategy.

    Anchors on the DB printed_number field (exact match against what OCR reads)
    as the primary signal, then uses artist → name_candidates → HP to resolve
    the small result sets that remain.

    PATH A (non-bare set_number: slash, No.NNN, promo):
      1. printed_number direct match + language  → 1 result → done (0.99)
      2. >1 results → artist → name_candidates → HP → else ambiguous
      3. 0 results → fallback: number variants + language, same disambiguation

    PATH B (bare NNN or no set_number):
      Pool by number (if available) + name search; score all rows against every
      name candidate, then artist → HP to break ties.
    """
    set_number: str = (ocr.get("set_number") or "").strip()
    name_candidates: List[str] = list(ocr.get("name_candidates") or [])
    if not name_candidates:
        single = (ocr.get("name") or "").strip()
        if single:
            name_candidates = [single]
    illustrator: str = (ocr.get("illustrator") or "").strip()
    hp: Optional[int] = ocr.get("hp")
    lang_code: Optional[str] = (ocr.get("language_code") or "").upper().strip() or None
    local_id_variants = _local_id_variants(set_number) if set_number else []

    def _base_q() -> Any:
        q = (
            db.query(CardV2, ExpansionV2)
            .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
            .filter(CardV2.game == "pokemon")
        )
        if lang_code:
            q = q.filter(CardV2.language_code == lang_code)
        return q

    # ------------------------------------------------------------------
    # PATH A: non-bare set_number
    # ------------------------------------------------------------------
    if set_number and not _is_bare_number(set_number):
        # Step 1: exact printed_number match
        rows = _base_q().filter(
            func.lower(CardV2.printed_number) == set_number.lower()
        ).all()

        if len(rows) == 1:
            return {"card": rows[0][0], "expansion": rows[0][1], "confidence": 0.99, "method": "v3_printed_number"}

        if len(rows) > 1:
            result = _v3_disambiguate(rows, name_candidates, illustrator, hp, "v3_printed_number")
            if result:
                return result
            filtered = _filter_by_name(rows, name_candidates)
            return {"ambiguous": True, "candidates": [{"card": r[0], "expansion": r[1]} for r in filtered[:10]]}

        # Step 2: 0 printed_number results — fallback to number variants
        if local_id_variants:
            rows2 = _base_q().filter(CardV2.number.in_(local_id_variants)).all()
            if len(rows2) == 1:
                return {"card": rows2[0][0], "expansion": rows2[0][1], "confidence": 0.75, "method": "v3_number_fallback"}
            if len(rows2) > 1:
                result = _v3_disambiguate(rows2, name_candidates, illustrator, hp, "v3_number_fallback")
                if result:
                    return result
                filtered2 = _filter_by_name(rows2, name_candidates)
                return {"ambiguous": True, "candidates": [{"card": r[0], "expansion": r[1]} for r in filtered2[:10]]}

        return None

    # ------------------------------------------------------------------
    # PATH B: bare number or no number — name-primary with multi-candidates
    # ------------------------------------------------------------------

    # PATH B sub-step: zero-padded bare numbers ("007", "036") from Topsun/Vending-era
    # cards where the number is printed alone with no slash total.
    # printed_number="007" only matches cards whose full printed number IS "007" —
    # slash-format cards like sv2a's "007/165" won't match, so this cleanly isolates
    # the vintage card without needing any name scoring.
    if set_number and set_number.startswith("0") and set_number.isdigit():
        pn_rows = _base_q().filter(
            func.lower(CardV2.printed_number) == set_number.lower()
        ).all()
        if len(pn_rows) == 1:
            return {
                "card": pn_rows[0][0],
                "expansion": pn_rows[0][1],
                "confidence": 0.95,
                "method": "v3_bare_printed_number",
            }
        if len(pn_rows) > 1:
            dis = _v3_disambiguate(pn_rows, name_candidates, illustrator, hp, "v3_bare_printed_number")
            if dis:
                return dis
        # 0 results or disambiguation failed — fall through to pool approach

    pool: List[tuple] = []

    # Pool A: by number variants
    if local_id_variants:
        pool.extend(_base_q().filter(CardV2.number.in_(local_id_variants)).limit(50).all())

    # Pool B: by name candidates (first 2 to limit queries)
    if len(pool) < 20:
        for candidate in name_candidates[:2]:
            if len(candidate) < 2:
                continue
            norm = _strip_accents(candidate)
            pool.extend(
                _base_q().filter(
                    or_(
                        func.unaccent(CardV2.name).ilike(f"%{norm}%"),
                        func.unaccent(CardV2.en_name).ilike(f"%{norm}%"),
                    )
                ).limit(30).all()
            )

    # Deduplicate preserving order
    seen_ids: set = set()
    unique_pool: List[tuple] = []
    for row in pool:
        if row[0].id not in seen_ids:
            seen_ids.add(row[0].id)
            unique_pool.append(row)
    pool = unique_pool[:50]

    if not pool:
        return None

    scored = sorted(
        [(row, _best_name_score(row[0], name_candidates)) for row in pool],
        key=lambda x: x[1],
        reverse=True,
    )

    if not scored or scored[0][1] < 75:
        return None

    top_score = scored[0][1]
    top = [row for row, s in scored if s >= top_score - 5]

    if len(top) == 1:
        r = scored[0][0]
        return {"card": r[0], "expansion": r[1], "confidence": round(top_score / 100 * 0.90, 2), "method": "v3_name_primary"}

    result = _v3_disambiguate(top, name_candidates, illustrator, hp, "v3_name")
    if result:
        return result

    if len(top) <= 10:
        return {"ambiguous": True, "candidates": [{"card": r[0], "expansion": r[1]} for r in top]}

    # > 10 name-tied candidates — HP-filter to produce a manageable ambiguous list
    # (e.g. スリーパー HP90 matches base1_ja + base3_ja, not sv6a HP110)
    if hp is not None:
        hp_reduced = [r for r in top if r[0].hp == str(hp)]
        if 0 < len(hp_reduced) <= 10:
            return {"ambiguous": True, "candidates": [{"card": r[0], "expansion": r[1]} for r in hp_reduced]}

    # Still too many — cap at 10 and surface as ambiguous rather than auto-picking
    return {"ambiguous": True, "candidates": [{"card": r[0], "expansion": r[1]} for r in top[:10]]}


def _parse_card_count(set_number: str) -> Optional[int]:
    """
    Extract the total card count from a set number string.
    '029/131'  -> 131
    '044/1910' -> 191  (OCR noise: 4th digit is a stray character, truncate to 3)
    'TG15/TG30' -> None (TG format doesn't map cleanly to expansion total)
    'No.150'   -> None (old Japanese Base-era Pokédex-number format, no set total)
    """
    if set_number.upper().startswith("NO."):
        return None
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
    'No.150'   -> ['150']  (old Japanese Base-era Pokédex-number format)
    Deduplicated so exact matches don't produce duplicates.
    """
    part = set_number.split("/")[0]
    if part.upper().startswith("NO."):
        digits = part[3:].strip()
        return [str(int(digits))] if digits.isdigit() else [digits]
    if part.upper().startswith("TG"):
        return [part.upper()]
    stripped = str(int(part)) if part.isdigit() else part
    return list(dict.fromkeys([part, stripped]))  # preserve order, deduplicate


# ---------------------------------------------------------------------------
# Quick Scan v2 — Claude extraction + weighted multi-field scoring
# ---------------------------------------------------------------------------

_SCORE_WEIGHTS: Dict[str, int] = {
    "name":          35,
    "number":        30,
    "hp":            10,
    "artist":        10,
    "attacks":        8,
    "flavor_text":    4,
    "rarity_symbol":  3,
}


def _max_possible_score_v2(card: CardV2) -> float:
    """Upper bound on _score_candidate_v2 for a card — reflects which metadata fields are populated.
    Used to normalise thresholds for sparse cards (e.g. vending Trainers with no number/HP/artist)
    that can never reach a fixed absolute threshold even with a perfect name match.
    """
    pts = float(_SCORE_WEIGHTS["name"])  # name always present
    if card.number:
        pts += _SCORE_WEIGHTS["number"]
    if card.hp:
        pts += _SCORE_WEIGHTS["hp"]
    if card.artist:
        pts += _SCORE_WEIGHTS["artist"]
    if card.attacks:
        pts += _SCORE_WEIGHTS["attacks"]
    if card.flavor_text:
        pts += _SCORE_WEIGHTS["flavor_text"]
    if card.rarity_code:
        pts += _SCORE_WEIGHTS["rarity_symbol"]
    return pts


def _normalize_number_for_scoring(raw: Optional[str]) -> str:
    """Normalize any printed card number to a bare card ID for equality comparison.
    '029/131' -> '29', 'No.150' -> '150', 'No. 150' -> '150', 'TG15/TG30' -> 'TG15'
    """
    if not raw:
        return ""
    raw = str(raw).strip()
    if raw.upper().startswith("NO."):
        digits = raw[3:].strip()
        return str(int(digits)) if digits.isdigit() else digits
    part = raw.split("/")[0].strip() if "/" in raw else raw
    if part.upper().startswith("TG"):
        return part.upper()
    if part.isdigit():
        return str(int(part))
    return part


def _score_candidate_v2(
    extracted: Dict[str, Any], card: CardV2, expansion: ExpansionV2
) -> float:
    """Score a single (CardV2, ExpansionV2) candidate against Claude-extracted fields.
    Returns 0–100 as a percentage of the card's own achievable maximum, so sparse
    cards (missing HP/artist/attacks in DB) compete fairly with rich ones."""
    score = 0.0

    # Name (35 pts): cross-check extracted name + en_name against DB name + en_name
    ext_names: List[str] = [n for n in [extracted.get("name"), extracted.get("en_name")] if n]
    db_names: List[str] = [n for n in [card.name, card.en_name] if n]
    name_score = 0
    for en in ext_names:
        for dn in db_names:
            name_score = max(name_score, fuzz.token_sort_ratio(en.lower(), dn.lower()))
    score += (name_score / 100) * _SCORE_WEIGHTS["name"]

    # Number (30 pts): normalize both sides before comparing
    ext_num = _normalize_number_for_scoring(extracted.get("number"))
    db_num = _normalize_number_for_scoring(card.number)
    if ext_num and db_num and ext_num == db_num:
        score += _SCORE_WEIGHTS["number"]

    # HP (10 pts)
    if extracted.get("hp") is not None and card.hp:
        try:
            if int(extracted["hp"]) == int(card.hp):
                score += _SCORE_WEIGHTS["hp"]
        except (ValueError, TypeError):
            pass

    # Artist (10 pts)
    if extracted.get("artist") and card.artist:
        artist_sim = fuzz.ratio(extracted["artist"].lower(), card.artist.lower())
        score += (artist_sim / 100) * _SCORE_WEIGHTS["artist"]

    # Attacks (8 pts): fuzzy match attack names
    ext_attacks: List[str] = extracted.get("attacks") or []
    db_attacks: List[Dict[str, Any]] = card.attacks or []
    if ext_attacks and db_attacks:
        db_attack_names = [a.get("name", "") for a in db_attacks if isinstance(a, dict)]
        if db_attack_names:
            matched = sum(
                1 for ea in ext_attacks
                if any(fuzz.token_sort_ratio(ea.lower(), da.lower()) > 80 for da in db_attack_names)
            )
            ratio = matched / max(len(ext_attacks), len(db_attack_names))
            score += ratio * _SCORE_WEIGHTS["attacks"]

    # Flavor text (4 pts)
    if extracted.get("flavor_text") and card.flavor_text:
        ft_sim = fuzz.partial_ratio(
            extracted["flavor_text"].lower(), card.flavor_text.lower()
        )
        score += (ft_sim / 100) * _SCORE_WEIGHTS["flavor_text"]

    # Rarity symbol (3 pts)
    if extracted.get("rarity_symbol") and card.rarity_code:
        if extracted["rarity_symbol"].strip() == card.rarity_code.strip():
            score += _SCORE_WEIGHTS["rarity_symbol"]

    max_possible = _max_possible_score_v2(card)
    if max_possible == 0:
        return 0.0
    # Normalized 0-100; tiny raw-score fraction breaks ties so a card with more
    # confirmed-matching fields (e.g. rarity "♦" confirmed vs rarity null) wins
    # over an equally-sparse card that just had nothing to mismatch.
    return round((score / max_possible) * 100 + score * 0.001, 4)


def _get_v2_candidate_pool(
    extracted: Dict[str, Any], db: Session, limit: int = 50
) -> List[tuple]:
    """
    DB-backed pre-filter returning a manageable (CardV2, ExpansionV2) pool.
    Uses number + name signals to narrow before full scoring — never scans the full table.
    """
    number: str = (extracted.get("number") or "").strip()
    name: str = (extracted.get("name") or "").strip()
    en_name: str = (extracted.get("en_name") or "").strip()
    language: str = (extracted.get("language") or "").strip().lower()

    number_variants = _local_id_variants(number) if number else []
    card_count = _parse_card_count(number) if number else None

    lang_code: Optional[str] = None
    if "japanese" in language:
        lang_code = "JA"
    elif language in ("english", "en"):
        lang_code = "EN"

    def base_q() -> Any:
        return (
            db.query(CardV2, ExpansionV2)
            .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
            .filter(CardV2.game == "pokemon")
        )

    rows: List[tuple] = []

    # Pool A-prime: number + name intersection — runs first so these targeted results
    # are guaranteed to be within unique[:limit] even when Pool A saturates on a common
    # number (e.g. 140 Japanese cards share number "69").
    if number_variants and (name or en_name):
        for search_name in [n for n in [name, en_name] if n and len(n) >= 2]:
            norm = _strip_accents(search_name)
            q = base_q().filter(
                CardV2.number.in_(number_variants),
                or_(
                    func.unaccent(CardV2.name).ilike(f"%{norm}%"),
                    func.unaccent(CardV2.en_name).ilike(f"%{norm}%"),
                ),
            )
            if lang_code:
                q = q.filter(CardV2.language_code == lang_code)
            rows.extend(q.limit(20).all())

    # Pool A: by card number — fills remaining slots with same-number candidates for scoring
    if number_variants:
        q = base_q().filter(CardV2.number.in_(number_variants))
        if lang_code:
            q = q.filter(CardV2.language_code == lang_code)
        if card_count is not None:
            q = _count_filter(q, card_count)
        pool_a = q.limit(limit).all()
        # Retry without card_count if empty (total/printed_total may be NULL)
        if not pool_a and card_count is not None:
            q2 = base_q().filter(CardV2.number.in_(number_variants))
            if lang_code:
                q2 = q2.filter(CardV2.language_code == lang_code)
            pool_a = q2.limit(limit).all()
        rows.extend(pool_a)

    # Pool B: by name ilike — used when number pool is small or absent.
    # Uses func.unaccent() on the DB side + _strip_accents() on the query side so
    # "Pokemon" matches "Pokémon" etc.
    if len(rows) < 10:
        for search_name in [name, en_name]:
            if search_name and len(search_name) >= 2:
                norm = _strip_accents(search_name)
                q = base_q().filter(
                    or_(
                        func.unaccent(CardV2.name).ilike(f"%{norm}%"),
                        func.unaccent(CardV2.en_name).ilike(f"%{norm}%"),
                    )
                )
                if lang_code:
                    q = q.filter(CardV2.language_code == lang_code)
                rows.extend(q.limit(limit).all())

    # Pool C: visible_text fallback — fires only when both name and number are absent.
    # Searches each text token Claude found on the card against card names so atypical
    # cards (e.g. vending series Trainer cards with no name box) can still be surfaced
    # as candidates for the user to pick from.
    _SKIP_TOKENS = {
        "pocket monsters card game", "pocket monsters", "pokemon", "card game",
        "pokemon card", "trainer", "energy", "basic",
    }
    if not name and not number:
        visible_text: List[str] = extracted.get("visible_text") or []
        for token in visible_text:
            if not token or len(token) < 4:
                continue
            if token.strip().lower() in _SKIP_TOKENS:
                continue
            norm = _strip_accents(token.strip())
            q = base_q().filter(
                or_(
                    func.unaccent(CardV2.name).ilike(f"%{norm}%"),
                    func.unaccent(CardV2.en_name).ilike(f"%{norm}%"),
                )
            )
            if lang_code:
                q = q.filter(CardV2.language_code == lang_code)
            rows.extend(q.limit(10).all())

    # Deduplicate preserving insertion order
    seen: set = set()
    unique: List[tuple] = []
    for row in rows:
        cid = row[0].id
        if cid not in seen:
            seen.add(cid)
            unique.append(row)

    return unique[:limit]


def match_card_from_claude_extract(
    extracted: Dict[str, Any], db: Session
) -> Optional[Dict[str, Any]]:
    """
    Match a card using Claude-extracted fields via weighted multi-field scoring.
    DB-pre-filtered then scored — never iterates the full table.

    Returns same shape as match_card_from_ocr:
      {"card": CardV2, "expansion": ExpansionV2, "confidence": float, "method": str}
    Or {"ambiguous": True, "candidates": [...]} when top candidates are too close to auto-select.
    Or None if no confident match found.
    """
    pool = _get_v2_candidate_pool(extracted, db)
    if not pool:
        return None

    scored: List[tuple] = sorted(
        [(row, _score_candidate_v2(extracted, row[0], row[1])) for row in pool],
        key=lambda x: x[1],
        reverse=True,
    )

    best_row, best_score = scored[0]

    # When both name and number were absent, Pool C found candidates via visible_text.
    # We can't auto-select with confidence — always surface as ambiguous for the user to pick.
    name_absent = not (extracted.get("name") or "").strip()
    number_absent = not (extracted.get("number") or "").strip()
    if name_absent and number_absent:
        top = [row for row, _ in scored[:5]]
        return {
            "ambiguous": True,
            "candidates": [{"card": row[0], "expansion": row[1]} for row in top],
        }

    # Below minimum threshold — no usable match.
    # Scores are normalized 0–100 (fraction of each card's own achievable max), so the
    # threshold is a flat percentage regardless of how many fields the card has in the DB.
    if best_score < 75:
        return None

    # Ambiguous: top-2 within 10 points and neither is clearly dominant (< 90% match)
    if len(scored) >= 2 and (scored[0][1] - scored[1][1]) < 10 and best_score < 90:
        top = [(row, s) for row, s in scored if s >= best_score - 15][:5]
        return {
            "ambiguous": True,
            "candidates": [{"card": row[0], "expansion": row[1]} for row, _ in top],
        }

    return {
        "card": best_row[0],
        "expansion": best_row[1],
        "confidence": round(best_score / 100, 2),
        "method": "claude_extract",
    }
