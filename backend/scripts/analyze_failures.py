#!/usr/bin/env python3
"""
Failure analysis tool for Quick Scan benchmark results.

Reads an enriched CSV produced by benchmark_scanners.py --output and prints:
  - Overall accuracy summary
  - Failure breakdown by failure_reason
  - Top failing sets (by failure count and failure rate)
  - Sample of OCR parse failures (what text was extracted vs expected)
  - Sample of catalog no-match cases (OCR extracted fields but nothing matched)
  - Sample of wrong matches (matched wrong card)
  - Match method distribution for correct hits

The CSV must have been generated with the updated benchmark_scanners.py that
includes the ocr_name / ocr_set_number / ocr_hp / match_method / failure_reason
columns. Older CSVs without these columns will produce an error with instructions.

Usage:
    python scripts/analyze_failures.py results.csv
    python scripts/analyze_failures.py gold_results.csv --top-sets 15
    python scripts/analyze_failures.py results.csv --samples 20
"""

import argparse
import csv
import sys
from collections import Counter
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# CSV loading
# ---------------------------------------------------------------------------

def load_csv(path: str) -> List[Dict[str, Any]]:
    """Load CSV rows, converting boolean/numeric strings to native types."""
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        rows = []
        for raw in reader:
            row: Dict[str, Any] = dict(raw)
            # Coerce boolean columns
            for col in ("quick_correct", "claude_correct"):
                if row.get(col) in ("True", "False"):
                    row[col] = row[col] == "True"
                elif row.get(col) in (None, "None", ""):
                    row[col] = None
            # Coerce numeric columns
            for col in ("quick_time_s", "claude_time_s", "match_confidence", "ocr_hp"):
                val = row.get(col)
                if val in (None, "None", ""):
                    row[col] = None
                else:
                    try:
                        row[col] = float(val)
                    except (ValueError, TypeError):
                        row[col] = None
            rows.append(row)
    return rows


def _check_enriched(rows: List[Dict[str, Any]]) -> None:
    """Exit with a clear message if the CSV is missing Option 1 columns."""
    if rows and "failure_reason" not in rows[0]:
        print(
            "ERROR: CSV is missing the 'failure_reason' column.\n"
            "This column is added by the updated benchmark_scanners.py.\n"
            "Re-run the benchmark with --output to generate an enriched CSV.",
            file=sys.stderr,
        )
        sys.exit(1)


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def _bar(count: int, total: int, width: int = 20) -> str:
    """Simple ASCII progress bar."""
    filled = int(width * count / total) if total else 0
    return "█" * filled + "░" * (width - filled)


def _pct(count: int, total: int) -> str:
    if total == 0:
        return "  0%"
    return f"{100 * count // total:>3}%"


def _trunc(s: Optional[str], n: int) -> str:
    if s is None:
        return "(none)"
    return s[:n] if len(s) <= n else s[:n - 1] + "…"


# ---------------------------------------------------------------------------
# Analysis sections
# ---------------------------------------------------------------------------

def _print_summary(rows: List[Dict[str, Any]]) -> None:
    total = len(rows)
    correct = sum(1 for r in rows if r["quick_correct"] is True)
    failures = total - correct
    print(f"\n{'═' * 62}")
    print(f"  QUICK SCAN ANALYSIS  |  {total} cards tested")
    print(f"{'═' * 62}")
    print(f"  Correct  : {correct:>4}  {_bar(correct, total)}  {_pct(correct, total)}")
    print(f"  Failed   : {failures:>4}  {_bar(failures, total)}  {_pct(failures, total)}")
    print()


def _print_failure_breakdown(failures: List[Dict[str, Any]]) -> None:
    if not failures:
        print("No failures — nothing to break down.\n")
        return

    total_fail = len(failures)
    reason_counts = Counter(r["failure_reason"] for r in failures)

    REASON_LABELS = {
        "fetch_failed":        "Image fetch failed",
        "ocr_error":           "OCR exception",
        "ocr_no_text":         "OCR — no text detected",
        "ocr_parse_miss":      "OCR — name+number unparsed",
        "catalog_no_match":    "Catalog — no match found",
        "catalog_wrong_match": "Catalog — wrong card matched",
    }

    print(f"FAILURE BREAKDOWN  ({total_fail} failures)")
    print("─" * 62)
    for reason, count in reason_counts.most_common():
        label = REASON_LABELS.get(reason, reason)
        print(
            f"  {label:<32}  {count:>4}  {_bar(count, total_fail, 12)}  {_pct(count, total_fail)}"
        )
    print()


def _print_top_failing_sets(
    rows: List[Dict[str, Any]], failures: List[Dict[str, Any]], top_n: int
) -> None:
    if not failures:
        return

    set_fail_counts = Counter(r["set_id"] for r in failures)
    set_total_counts = Counter(r["set_id"] for r in rows)

    # Sort by failure count descending, break ties by failure rate
    ranked = sorted(
        set_fail_counts.items(),
        key=lambda kv: (kv[1], kv[1] / max(set_total_counts[kv[0]], 1)),
        reverse=True,
    )[:top_n]

    print(f"TOP FAILING SETS  (top {len(ranked)})")
    print("─" * 62)
    print(f"  {'Set ID':<14}  {'Failed':>6}  {'Tested':>6}  {'Rate':>5}")
    print(f"  {'──────':<14}  {'──────':>6}  {'──────':>6}  {'────':>5}")
    for set_id, fail_count in ranked:
        tested = set_total_counts[set_id]
        rate = _pct(fail_count, tested)
        print(f"  {set_id:<14}  {fail_count:>6}  {tested:>6}  {rate:>5}")
    print()


def _print_ocr_parse_failures(
    failures: List[Dict[str, Any]], sample_n: int
) -> None:
    parse_misses = [
        r for r in failures
        if r.get("failure_reason") in ("ocr_parse_miss", "ocr_no_text", "ocr_error")
    ]
    if not parse_misses:
        return

    print(f"OCR PARSE FAILURES  ({len(parse_misses)} cards — showing up to {sample_n})")
    print("─" * 62)
    print(f"  {'Expected card':<22}  {'Set':<10}  {'OCR name':<20}  {'OCR #':<10}")
    print(f"  {'─────────────':<22}  {'───':<10}  {'────────':<20}  {'─────':<10}")
    for r in parse_misses[:sample_n]:
        expected = _trunc(r.get("card_name"), 22)
        set_id   = _trunc(r.get("set_id"), 10)
        ocr_name = _trunc(r.get("ocr_name"), 20)
        ocr_num  = _trunc(r.get("ocr_set_number"), 10)
        reason   = r.get("failure_reason", "")
        suffix   = f"  [{reason}]" if reason == "ocr_error" else ""
        print(f"  {expected:<22}  {set_id:<10}  {ocr_name:<20}  {ocr_num:<10}{suffix}")
    if len(parse_misses) > sample_n:
        print(f"  … and {len(parse_misses) - sample_n} more")
    print()


def _print_catalog_no_matches(
    failures: List[Dict[str, Any]], sample_n: int
) -> None:
    no_matches = [r for r in failures if r.get("failure_reason") == "catalog_no_match"]
    if not no_matches:
        return

    print(f"CATALOG NO-MATCH  ({len(no_matches)} cards — OCR extracted fields but nothing matched)")
    print("─" * 62)
    print(f"  {'Expected card':<22}  {'Set':<10}  {'OCR name':<22}  {'OCR #':<10}  {'HP':>4}")
    print(f"  {'─────────────':<22}  {'───':<10}  {'────────':<22}  {'─────':<10}  {'──':>4}")
    for r in no_matches[:sample_n]:
        expected = _trunc(r.get("card_name"), 22)
        set_id   = _trunc(r.get("set_id"), 10)
        ocr_name = _trunc(r.get("ocr_name"), 22)
        ocr_num  = _trunc(r.get("ocr_set_number"), 10)
        hp       = str(int(r["ocr_hp"])) if r.get("ocr_hp") is not None else "—"
        print(f"  {expected:<22}  {set_id:<10}  {ocr_name:<22}  {ocr_num:<10}  {hp:>4}")
    if len(no_matches) > sample_n:
        print(f"  … and {len(no_matches) - sample_n} more")
    print()


def _print_wrong_matches(
    failures: List[Dict[str, Any]], sample_n: int
) -> None:
    wrong = [r for r in failures if r.get("failure_reason") == "catalog_wrong_match"]
    if not wrong:
        return

    print(f"WRONG MATCHES  ({len(wrong)} cards — matched a card, but the wrong one)")
    print("─" * 62)
    print(f"  {'Expected':<22}  {'Matched (wrong)':<22}  {'OCR name':<20}")
    print(f"  {'────────':<22}  {'───────────────':<22}  {'────────':<20}")
    for r in wrong[:sample_n]:
        expected = _trunc(r.get("card_id"), 22)
        matched  = _trunc(r.get("quick_matched_id"), 22)
        ocr_name = _trunc(r.get("ocr_name"), 20)
        print(f"  {expected:<22}  {matched:<22}  {ocr_name:<20}")
    if len(wrong) > sample_n:
        print(f"  … and {len(wrong) - sample_n} more")
    print()


def _print_match_method_distribution(correct: List[Dict[str, Any]]) -> None:
    if not correct:
        return

    method_counts = Counter(r.get("match_method") or "unknown" for r in correct)
    total_correct = len(correct)

    METHOD_LABELS = {
        "exact":           "Tier 1: name + local_id exact",
        "exact_no_count":  "Tier 1b: name + local_id (no card count)",
        "local_id":        "Tier 2: local_id only (unique)",
        "local_id_hp":     "Tier 3: local_id + HP disambiguation",
        "fuzzy_name":      "Tier 4: fuzzy name match",
        "unknown":         "Unknown",
    }

    print(f"MATCH METHOD DISTRIBUTION  ({total_correct} correct hits)")
    print("─" * 62)
    for method, count in method_counts.most_common():
        label = METHOD_LABELS.get(method, method)
        print(
            f"  {label:<38}  {count:>4}  {_bar(count, total_correct, 10)}  {_pct(count, total_correct)}"
        )
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analyze Quick Scan benchmark failures from an enriched CSV."
    )
    parser.add_argument("csv_file", help="CSV output from benchmark_scanners.py --output")
    parser.add_argument(
        "--top-sets", type=int, default=10,
        help="Number of top failing sets to show (default: 10)",
    )
    parser.add_argument(
        "--samples", type=int, default=15,
        help="Max sample rows to show per failure category (default: 15)",
    )
    args = parser.parse_args()

    rows = load_csv(args.csv_file)
    if not rows:
        print("CSV is empty.")
        sys.exit(0)

    _check_enriched(rows)

    correct  = [r for r in rows if r["quick_correct"] is True]
    failures = [r for r in rows if r["quick_correct"] is not True]

    _print_summary(rows)
    _print_failure_breakdown(failures)
    _print_top_failing_sets(rows, failures, args.top_sets)
    _print_ocr_parse_failures(failures, args.samples)
    _print_catalog_no_matches(failures, args.samples)
    _print_wrong_matches(failures, args.samples)
    _print_match_method_distribution(correct)


if __name__ == "__main__":
    main()
