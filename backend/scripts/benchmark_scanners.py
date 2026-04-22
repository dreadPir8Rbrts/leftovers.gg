#!/usr/bin/env python3
"""
Scanner accuracy and latency benchmark.

Randomly selects one card per set from the catalog (only cards with a non-null
image_url), fetches each card's TCGdex image, submits it to the enabled
scanner(s), and reports per-card results plus an accuracy/latency summary.

Option 1 — Enriched CSV output:
  Each row includes intermediate OCR fields (ocr_name, ocr_set_number, ocr_hp),
  match metadata (match_method, match_confidence), and a failure_reason that
  classifies exactly where in the pipeline a miss occurred:
    fetch_failed      — image download failed
    ocr_error         — exception thrown during OCR call
    ocr_no_text       — Vision returned no usable text
    ocr_parse_miss    — text found but name and number both unparsed
    catalog_no_match  — valid OCR fields but no DB hit
    catalog_wrong_match — matched a card, but the wrong one
    correct           — match was right

Option 2 — Gold set:
  --generate-gold   Samples 2 cards per series, writes scripts/gold_set.json, exits.
  --gold            Loads scripts/gold_set.json instead of random sampling.
                    Use this for reproducible comparisons across code changes.

Usage:
    # Quick Scan only, all ~200 sets, low-res images
    python scripts/benchmark_scanners.py

    # Random 20 sets
    python scripts/benchmark_scanners.py --limit 20

    # Include Claude Vision (incurs Anthropic API costs)
    python scripts/benchmark_scanners.py --limit 20 --claude

    # Restrict to one set
    python scripts/benchmark_scanners.py --set sv04 --claude

    # High-res images and save enriched CSV
    python scripts/benchmark_scanners.py --limit 50 --high-res --output results.csv

    # Generate the gold set (run once, re-run to refresh)
    python scripts/benchmark_scanners.py --generate-gold

    # Benchmark against the gold set
    python scripts/benchmark_scanners.py --gold --output gold_results.csv
"""

import argparse
import asyncio
import csv
import datetime
import json
import os
import random
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

# Allow running from backend/ or from backend/scripts/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal
from app.models.catalog import Card, Set, Serie
from app.services.ocr import extract_card_text
from app.services.catalog_match import match_card_from_ocr

FETCH_TIMEOUT = 20  # seconds per image download
GOLD_SET_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gold_set.json")


# ---------------------------------------------------------------------------
# Image fetching
# ---------------------------------------------------------------------------

async def fetch_image(url: str) -> Optional[bytes]:
    """Download image bytes from a URL. Returns None on any error."""
    try:
        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                return resp.content
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Failure classification (Option 1)
# ---------------------------------------------------------------------------

def _failure_reason(
    quick_id: Optional[str],
    expected_id: str,
    ocr: Optional[Dict[str, Any]],
    match: Optional[Dict[str, Any]],
) -> str:
    """
    Classify why a Quick Scan result was wrong (or 'correct' if it was right).
    Called with ocr=None when an exception prevented the OCR call from completing.
    """
    if ocr is None:
        return "ocr_error"
    if not ocr.get("name") and not ocr.get("set_number") and not ocr.get("hp"):
        return "ocr_no_text"
    if not ocr.get("name") and not ocr.get("set_number"):
        return "ocr_parse_miss"
    if match is None:
        return "catalog_no_match"
    if quick_id != expected_id:
        return "catalog_wrong_match"
    return "correct"


# ---------------------------------------------------------------------------
# Scanner runners
# ---------------------------------------------------------------------------

async def run_quick_scan(
    image_bytes: bytes, db
) -> Tuple[Optional[str], Optional[Dict[str, Any]], Optional[Dict[str, Any]], float]:
    """
    Run the Quick Scan pipeline (OCR + catalog match).
    Returns (matched_card_id, ocr_result, match_result, elapsed_seconds).
    ocr_result and match_result are None if an exception was raised.
    """
    t0 = time.perf_counter()
    ocr: Optional[Dict[str, Any]] = None
    match: Optional[Dict[str, Any]] = None
    card_id: Optional[str] = None
    try:
        ocr = await extract_card_text(image_bytes)
        match = await asyncio.to_thread(match_card_from_ocr, ocr, db)
        card_id = match["card"].id if match else None
    except Exception as exc:
        print(f"    [quick scan error] {exc}", file=sys.stderr)
    return card_id, ocr, match, time.perf_counter() - t0


async def run_claude_scan(
    image_bytes: bytes, db
) -> Tuple[Optional[str], float]:
    """
    Run the Claude Vision pipeline (Anthropic API + catalog lookup).
    Returns (matched_card_id or None, elapsed_seconds).
    Images from TCGdex CDN are WebP — pass the correct media_type.
    """
    from app.services.claude_vision import call_claude, lookup_card_from_claude_result

    t0 = time.perf_counter()
    try:
        result = await call_claude(image_bytes, media_type="image/webp")
        confidence = float(result.get("confidence", 0.0))
        if confidence < 0.6:
            card_id = None
        else:
            row = lookup_card_from_claude_result(result, db)
            card_id = row[0].id if row else None
    except Exception as exc:
        print(f"    [claude error] {exc}", file=sys.stderr)
        card_id = None
    return card_id, time.perf_counter() - t0


# ---------------------------------------------------------------------------
# Card sampling
# ---------------------------------------------------------------------------

def sample_cards(
    db,
    limit: Optional[int],
    set_filter: Optional[str],
) -> List[Tuple[Card, Set, Serie]]:
    """
    Return one randomly chosen card per set, shuffled set order.

    Strategy:
      1. Find all sets that have at least one card with non-null image_url.
      2. Shuffle the set list.
      3. Apply --limit (take first N sets from the shuffled list).
      4. For each set, pick one card at random.
    """
    q = (
        db.query(Set, Serie)
        .join(Serie, Set.serie_id == Serie.id)
        .join(Card, Card.set_id == Set.id)
        .filter(Card.image_url.isnot(None))
        .distinct()
    )
    if set_filter:
        q = q.filter(Set.id == set_filter)

    sets = q.all()
    random.shuffle(sets)

    if limit is not None:
        sets = sets[:limit]

    result: List[Tuple[Card, Set, Serie]] = []
    for set_row, serie in sets:
        candidates = (
            db.query(Card)
            .filter(Card.set_id == set_row.id, Card.image_url.isnot(None))
            .all()
        )
        if candidates:
            result.append((random.choice(candidates), set_row, serie))

    return result


def load_gold_set(db, gold_file: str) -> List[Tuple[Card, Set, Serie]]:
    """
    Load the pinned gold set from gold_set.json.
    Cards missing from the catalog (image_url=None) are silently skipped.
    """
    with open(gold_file) as f:
        data = json.load(f)
    card_ids: List[str] = data.get("card_ids", [])
    result: List[Tuple[Card, Set, Serie]] = []
    for card_id in card_ids:
        row = (
            db.query(Card, Set, Serie)
            .join(Set, Card.set_id == Set.id)
            .join(Serie, Set.serie_id == Serie.id)
            .filter(Card.id == card_id, Card.image_url.isnot(None))
            .first()
        )
        if row:
            result.append(row)
    return result


def generate_gold_set(db, output_path: str) -> None:
    """
    Sample 2 cards per series and write to gold_set.json.
    Provides broad coverage across all eras (~42 cards for 21 series).
    After generating, manually add known edge-case card IDs to the file
    (e.g. TG trainer gallery, EX/GX/VMAX, Base Set classics) to harden the set.
    """
    series_list = db.query(Serie).order_by(Serie.name).all()
    card_ids: List[str] = []
    for serie in series_list:
        candidates = (
            db.query(Card)
            .join(Set, Card.set_id == Set.id)
            .filter(Set.serie_id == serie.id, Card.image_url.isnot(None))
            .all()
        )
        if candidates:
            chosen = random.sample(candidates, min(2, len(candidates)))
            card_ids.extend(c.id for c in chosen)

    data = {
        "description": (
            "Gold test set — 2 random cards per series. "
            "Regenerate with --generate-gold. "
            "Manually append edge-case card IDs (TG, EX, GX, VMAX, Base Set) as needed."
        ),
        "generated_at": str(datetime.date.today()),
        "total_cards": len(card_ids),
        "card_ids": card_ids,
    }
    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Gold set written to {output_path}  ({len(card_ids)} cards)")
    print("Tip: open the file and append known edge-case card IDs to improve coverage.\n")


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def _fmt_result(matched_id: Optional[str], expected_id: str) -> str:
    if matched_id is None:
        return "✗ (no match)"
    if matched_id == expected_id:
        return "✓"
    # Show the wrong ID, truncated so it fits the column
    return f"✗ {matched_id[:16]}"


def _fmt_time(t: float) -> str:
    return f"{t:.2f}s"


def _percentile(values: List[float], pct: float) -> float:
    if not values:
        return 0.0
    idx = min(int(len(values) * pct), len(values) - 1)
    return sorted(values)[idx]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Benchmark Quick Scan and Claude Vision accuracy + latency."
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Max number of sets to test (default: all ~200). Ignored with --gold.",
    )
    parser.add_argument(
        "--claude", action="store_true",
        help="Also run Claude Vision — incurs Anthropic API costs, off by default",
    )
    parser.add_argument(
        "--set", dest="set_id", default=None,
        help="Restrict to a single set ID (e.g. sv04). Ignored with --gold.",
    )
    parser.add_argument(
        "--output", default=None,
        help="Write full enriched results to a CSV file",
    )
    parser.add_argument(
        "--high-res", action="store_true",
        help="Use /high.webp instead of /low.webp",
    )
    parser.add_argument(
        "--gold", action="store_true",
        help="Use the pinned gold set (scripts/gold_set.json) instead of random sampling",
    )
    parser.add_argument(
        "--generate-gold", action="store_true",
        help="Generate scripts/gold_set.json (2 cards per series) and exit",
    )
    args = parser.parse_args()

    db = SessionLocal()

    # -- Generate gold set and exit ------------------------------------------
    if args.generate_gold:
        generate_gold_set(db, GOLD_SET_PATH)
        db.close()
        return

    # -- Card selection -------------------------------------------------------
    if args.gold:
        if not os.path.exists(GOLD_SET_PATH):
            print(
                f"Gold set not found: {GOLD_SET_PATH}\n"
                "Run with --generate-gold first.",
                file=sys.stderr,
            )
            db.close()
            sys.exit(1)
        sampled = load_gold_set(db, GOLD_SET_PATH)
        mode_label = f"gold set ({GOLD_SET_PATH})"
    else:
        sampled = sample_cards(db, args.limit, args.set_id)
        mode_label = "random sample"

    # Quick Scan uses low-res (text is readable at low resolution).
    # Claude Vision always uses high-res — it needs image detail for artwork
    # recognition and the low.webp thumbnails are often too small to process.
    # --high-res upgrades Quick Scan to high-res as well (for comparison).
    quick_res  = "high" if args.high_res else "low"
    claude_res = "high"

    print(f"\nBenchmarking {len(sampled)} cards  |  mode: {mode_label}  |  quick scan: {quick_res}.webp  |  claude: {claude_res}.webp")
    if args.claude:
        print("Claude Vision : ENABLED  (Anthropic API costs apply)")
    else:
        print("Claude Vision : disabled  (pass --claude to enable)")
    print()

    # Column widths
    W_NAME  = 22
    W_SET   = 10
    W_NUM   = 6
    W_SCAN  = 20
    W_TIME  = 6

    def _header() -> str:
        h = (
            f"{'Card':<{W_NAME}}  {'Set':<{W_SET}}  {'#':<{W_NUM}}  "
            f"{'Quick Scan':<{W_SCAN}}  {'Time':<{W_TIME}}"
        )
        if args.claude:
            h += f"  {'Claude Vision':<{W_SCAN}}  {'Time':<{W_TIME}}"
        return h

    header = _header()
    print(header)
    print("─" * len(header))

    rows: List[Dict[str, Any]] = []

    for card, set_row, serie in sampled:
        quick_url  = f"{card.image_url}/{quick_res}.webp"
        claude_url = f"{card.image_url}/{claude_res}.webp"

        name_col = card.name[:W_NAME]
        set_col  = set_row.id[:W_SET]
        num_col  = card.local_id[:W_NUM]

        # Fetch Quick Scan image (always needed)
        quick_bytes = await fetch_image(quick_url)
        if quick_bytes is None:
            line = (
                f"{name_col:<{W_NAME}}  {set_col:<{W_SET}}  {num_col:<{W_NUM}}  "
                f"{'(fetch failed)':<{W_SCAN}}  {'—':<{W_TIME}}"
            )
            if args.claude:
                line += f"  {'—':<{W_SCAN}}  {'—':<{W_TIME}}"
            print(line)
            rows.append({
                "card_id":           card.id,
                "card_name":         card.name,
                "set_id":            set_row.id,
                "set_name":          set_row.name,
                "local_id":          card.local_id,
                "quick_image_url":   quick_url,
                "claude_image_url":  claude_url if args.claude else None,
                "quick_matched_id":  None,
                "quick_correct":     False,
                "quick_time_s":      None,
                "ocr_name":          None,
                "ocr_set_number":    None,
                "ocr_hp":            None,
                "match_method":      None,
                "match_confidence":  None,
                "failure_reason":    "fetch_failed",
                "claude_matched_id": None,
                "claude_correct":    None,
                "claude_time_s":     None,
            })
            continue

        # Quick Scan
        quick_id, ocr_result, match_result, quick_time = await run_quick_scan(quick_bytes, db)

        # Claude Vision (optional) — always uses high-res image
        claude_id: Optional[str] = None
        claude_time: Optional[float] = None
        if args.claude:
            await asyncio.sleep(0.5)  # gentle rate limiting
            claude_bytes = (
                quick_bytes if claude_res == quick_res
                else await fetch_image(claude_url)
            )
            if claude_bytes:
                claude_id, claude_time = await run_claude_scan(claude_bytes, db)

        line = (
            f"{name_col:<{W_NAME}}  {set_col:<{W_SET}}  {num_col:<{W_NUM}}  "
            f"{_fmt_result(quick_id, card.id):<{W_SCAN}}  {_fmt_time(quick_time):<{W_TIME}}"
        )
        if args.claude:
            line += (
                f"  {_fmt_result(claude_id, card.id):<{W_SCAN}}"
                f"  {_fmt_time(claude_time) if claude_time is not None else '—':<{W_TIME}}"
            )
        print(line)

        rows.append({
            "card_id":           card.id,
            "card_name":         card.name,
            "set_id":            set_row.id,
            "set_name":          set_row.name,
            "local_id":          card.local_id,
            "quick_image_url":   quick_url,
            "claude_image_url":  claude_url if args.claude else None,
            "quick_matched_id":  quick_id,
            "quick_correct":     quick_id == card.id,
            "quick_time_s":      round(quick_time, 3),
            # Option 1 — intermediate OCR + match fields
            "ocr_name":          ocr_result.get("name") if ocr_result else None,
            "ocr_set_number":    ocr_result.get("set_number") if ocr_result else None,
            "ocr_hp":            ocr_result.get("hp") if ocr_result else None,
            "match_method":      match_result.get("method") if match_result else None,
            "match_confidence":  match_result.get("confidence") if match_result else None,
            "failure_reason":    _failure_reason(quick_id, card.id, ocr_result, match_result),
            # Claude Vision
            "claude_matched_id": claude_id,
            "claude_correct":    (claude_id == card.id) if args.claude else None,
            "claude_time_s":     round(claude_time, 3) if claude_time is not None else None,
        })

    db.close()

    # Summary
    total = len(rows)
    if total == 0:
        print("\nNo results.")
        return

    print()
    print("─" * len(header))

    quick_rows    = [r for r in rows if r["quick_time_s"] is not None]
    quick_correct = sum(1 for r in rows if r["quick_correct"] is True)
    quick_times   = [r["quick_time_s"] for r in quick_rows]
    print(
        f"Quick Scan :  {quick_correct}/{total} correct "
        f"({100 * quick_correct // total}%)  —  "
        f"p50: {_percentile(quick_times, 0.50):.2f}s  "
        f"p95: {_percentile(quick_times, 0.95):.2f}s"
    )

    if args.claude:
        claude_correct = sum(1 for r in rows if r["claude_correct"])
        claude_times   = [r["claude_time_s"] for r in rows if r["claude_time_s"] is not None]
        print(
            f"Claude     :  {claude_correct}/{total} correct "
            f"({100 * claude_correct // total}%)  —  "
            f"p50: {_percentile(claude_times, 0.50):.2f}s  "
            f"p95: {_percentile(claude_times, 0.95):.2f}s"
        )

    print()

    # CSV export
    if args.output and rows:
        with open(args.output, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
        print(f"Results written to {args.output}\n")


if __name__ == "__main__":
    asyncio.run(main())
