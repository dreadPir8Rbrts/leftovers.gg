#!/usr/bin/env python3
"""
Autonomous Quick Scan improvement loop.

Repeatedly:
  1. Runs the gold set benchmark → CSV
  2. Analyzes failures
  3. Calls Claude API to generate targeted improvements to ocr.py / catalog_match.py
  4. Applies changes and re-benchmarks to measure impact
  5. Reverts if accuracy drops (regression guard)

Stops when any one of:
  - Elapsed time >= 30 minutes
  - Quick Scan accuracy >= 70%
  - Accuracy improvement from last iteration < 3 percentage points (plateau)
  - Claude finds no more actionable improvements
  - Applied changes cause a regression (reverted before stopping)

Outputs a bottleneck report on any stop condition other than hitting the target.

Usage (from backend/ with venv active):
    python scripts/improvement_loop.py
"""

import csv
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import anthropic

# ---------------------------------------------------------------------------
# Paths and constants
# ---------------------------------------------------------------------------

BACKEND_DIR   = Path(__file__).parent.parent.resolve()
SCRIPTS_DIR   = Path(__file__).parent.resolve()
GOLD_SET_PATH = SCRIPTS_DIR / "gold_set.json"
OCR_PATH      = BACKEND_DIR / "app" / "services" / "ocr.py"
MATCH_PATH    = BACKEND_DIR / "app" / "services" / "catalog_match.py"

ACCURACY_TARGET      = 0.70          # stop when accuracy reaches this
PLATEAU_THRESHOLD    = 0.03          # stop when improvement < 3 percentage points
MAX_DURATION_SECONDS = 30 * 60       # 30 minutes hard cap
MODEL                = "claude-sonnet-4-6"

# Files the loop is allowed to modify — anything else Claude proposes is ignored.
_ALLOWED_FILES: Dict[str, Path] = {
    "app/services/ocr.py":            OCR_PATH,
    "app/services/catalog_match.py":  MATCH_PATH,
}


# ---------------------------------------------------------------------------
# Environment setup
# ---------------------------------------------------------------------------

def _load_dotenv() -> None:
    """
    Load backend/.env into os.environ so the Anthropic SDK can find ANTHROPIC_API_KEY.
    Standalone scripts don't go through FastAPI / pydantic-settings startup, so the
    .env file is not automatically read. Uses setdefault — never overwrites vars that
    are already set in the shell environment.
    """
    env_path = BACKEND_DIR / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        os.environ.setdefault(key, val)


# ---------------------------------------------------------------------------
# Subprocess helpers
# ---------------------------------------------------------------------------

def run_benchmark(output_csv: Path) -> float:
    """Run the gold set benchmark, write results to CSV, return accuracy (0.0–1.0)."""
    result = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / "benchmark_scanners.py"),
         "--gold", "--output", str(output_csv)],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Benchmark failed:\n{result.stderr[-2000:]}")
    return _accuracy_from_csv(output_csv)


def _accuracy_from_csv(csv_path: Path) -> float:
    with open(csv_path, newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        return 0.0
    correct = sum(1 for r in rows if r.get("quick_correct") == "True")
    return correct / len(rows)


def run_analysis(csv_path: Path) -> str:
    """Run analyze_failures.py and return its stdout."""
    result = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / "analyze_failures.py"), str(csv_path)],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
    )
    return result.stdout or result.stderr


# ---------------------------------------------------------------------------
# Claude API — improvement suggestions
# ---------------------------------------------------------------------------

# Claude must respond in this exact delimiter format so we can parse file content
# reliably without JSON escaping issues.
_RESPONSE_FORMAT = """\
Respond using ONLY this exact format — no markdown, no extra text outside the delimiters:

===REASONING===
<1-3 sentences: which failure pattern you identified and what you changed>
===END===

===FILE:app/services/ocr.py===
<complete new file content — omit this block entirely if you are NOT changing this file>
===END===

===FILE:app/services/catalog_match.py===
<complete new file content — omit this block entirely if you are NOT changing this file>
===END===

If you find no actionable improvements, use this instead:

===NO_CHANGES===
<brief explanation of why no further improvements are possible>
===END===
"""


def call_claude_for_improvements(
    analysis: str,
    ocr_src: str,
    match_src: str,
    iteration: int,
) -> Dict[str, Any]:
    """
    Call Claude API with the failure analysis and current source files.
    Returns {"reasoning": str, "changes": [{"file": str, "content": str}]}.
    """
    client = anthropic.Anthropic()

    prompt = f"""You are autonomously improving a Google Cloud Vision OCR integration \
for a Pokémon card scanning system. This is iteration {iteration} of a self-improvement loop.

The pipeline has two stages:
  - app/services/ocr.py          — parses raw OCR text into structured fields (name, set_number, hp)
  - app/services/catalog_match.py — matches extracted fields to a PostgreSQL catalog of 22,754 cards

CONSTRAINTS:
  - Python 3.9: use Optional[X], List[X] from typing; never X | None or list[X]
  - Do NOT add new dependencies (rapidfuzz and re are already available)
  - Return the COMPLETE file content for any file you change (not diffs or snippets)
  - Make ONE focused change per iteration — fix the single most impactful failure pattern
  - Do not refactor, rename, or restructure code unrelated to the fix

CURRENT FAILURE ANALYSIS:
{analysis}

CURRENT app/services/ocr.py:
```python
{ocr_src}
```

CURRENT app/services/catalog_match.py:
```python
{match_src}
```

Identify the single most impactful actionable failure pattern from the analysis above \
and implement a fix for it. Focus on patterns with the highest failure count first.

{_RESPONSE_FORMAT}"""

    message = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    return _parse_claude_response(message.content[0].text)


def _parse_claude_response(raw: str) -> Dict[str, Any]:
    """Parse the delimiter-based response into a structured dict."""
    result: Dict[str, Any] = {"reasoning": "", "changes": []}

    if "===NO_CHANGES===" in raw:
        m = re.search(r"===NO_CHANGES===\n(.*?)(?:\n===END===|$)", raw, re.DOTALL)
        result["reasoning"] = m.group(1).strip() if m else "no changes"
        return result

    m = re.search(r"===REASONING===\n(.*?)\n===END===", raw, re.DOTALL)
    if m:
        result["reasoning"] = m.group(1).strip()

    for fm in re.finditer(r"===FILE:(.+?)===\n(.*?)\n===END===", raw, re.DOTALL):
        file_key = fm.group(1).strip()
        if file_key in _ALLOWED_FILES:
            result["changes"].append({"file": file_key, "content": fm.group(2)})
        else:
            print(f"  WARNING: Claude proposed changes to '{file_key}' — not in allowed list, skipping")

    return result


# ---------------------------------------------------------------------------
# File backup / apply / revert
# ---------------------------------------------------------------------------

def backup_files(backup_dir: Path) -> None:
    backup_dir.mkdir(parents=True, exist_ok=True)
    for path in _ALLOWED_FILES.values():
        (backup_dir / path.name).write_text(path.read_text())


def apply_changes(changes: List[Dict[str, Any]]) -> None:
    for change in changes:
        path = _ALLOWED_FILES[change["file"]]  # already validated in _parse_claude_response
        path.write_text(change["content"])
        print(f"    Applied: {change['file']}")


def revert_from_backup(backup_dir: Path) -> None:
    for path in _ALLOWED_FILES.values():
        backup = backup_dir / path.name
        if backup.exists():
            path.write_text(backup.read_text())
            print(f"    Reverted: {path.name}")


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def _div(char: str = "─", w: int = 64) -> str:
    return char * w


def _print_header() -> None:
    print(_div("═"))
    print("  QUICK SCAN AUTONOMOUS IMPROVEMENT LOOP")
    print(f"  Target: {ACCURACY_TARGET:.0%}  │  Plateau: <{PLATEAU_THRESHOLD:.0%}/iter  │  Timeout: 30 min")
    print(_div("═"))
    print(flush=True)


def _print_iteration(n: int, elapsed_min: float, accuracy: float) -> None:
    print(f"\n{_div()}")
    print(f"  Iteration {n}  │  {elapsed_min:.1f} min elapsed  │  Accuracy so far: {accuracy:.0%}")
    print(_div(), flush=True)


def _print_stop(reason: str) -> None:
    print(f"\n{_div('═')}")
    print(f"  STOPPED: {reason}")
    print(_div("═"), flush=True)


def _print_bottleneck_report(
    csv_path: Path,
    stop_reason: str,
    history: List[Tuple[float, str]],
) -> None:
    print(f"\n{_div('═')}")
    print("  BOTTLENECK REPORT")
    print(_div("═"))
    print(f"  Stop reason : {stop_reason}")
    print(f"  Iterations  : {len(history) - 1}")
    print()
    print("  Accuracy progression:")
    for i, (acc, note) in enumerate(history):
        label = "baseline" if i == 0 else f"  iter {i:>2}"
        print(f"    {label}:  {acc:.0%}  {note}")
    print()
    print("  Final failure breakdown (from analyze_failures.py):")
    print(_div())
    print(run_analysis(csv_path), flush=True)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main() -> None:
    _load_dotenv()

    if not GOLD_SET_PATH.exists():
        print("Gold set not found. Generate it first:")
        print("  python scripts/benchmark_scanners.py --generate-gold")
        sys.exit(1)

    _print_header()
    start_time = time.time()
    history: List[Tuple[float, str]] = []
    stop_reason: Optional[str] = None

    # ── Baseline ────────────────────────────────────────────────────────────
    print("[Baseline] Running initial benchmark...", flush=True)
    baseline_csv = SCRIPTS_DIR / "loop_v0_baseline.csv"
    try:
        current_accuracy = run_benchmark(baseline_csv)
    except RuntimeError as exc:
        print(f"Baseline benchmark failed: {exc}")
        sys.exit(1)

    last_good_csv = baseline_csv
    history.append((current_accuracy, "(baseline)"))
    print(f"  Baseline accuracy: {current_accuracy:.0%}", flush=True)

    if current_accuracy >= ACCURACY_TARGET:
        print(f"\nAccuracy target already met at baseline ({current_accuracy:.0%}). Nothing to do.")
        sys.exit(0)

    # ── Improvement loop ────────────────────────────────────────────────────
    iteration = 0
    while True:
        iteration += 1
        elapsed = time.time() - start_time
        _print_iteration(iteration, elapsed / 60, current_accuracy)

        # Time check before doing expensive work
        if elapsed >= MAX_DURATION_SECONDS:
            stop_reason = "time limit reached (30 minutes)"
            break

        # Analyze
        print("  Analyzing failures...", flush=True)
        analysis = run_analysis(last_good_csv)

        # Request improvements from Claude
        print("  Requesting improvements from Claude...", flush=True)
        try:
            result = call_claude_for_improvements(
                analysis,
                OCR_PATH.read_text(),
                MATCH_PATH.read_text(),
                iteration,
            )
        except Exception as exc:
            stop_reason = f"Claude API error: {exc}"
            break

        print(f"  Reasoning: {result['reasoning']}", flush=True)

        if not result["changes"]:
            stop_reason = "Claude found no further actionable improvements"
            break

        # Backup, apply, re-benchmark
        backup_dir = SCRIPTS_DIR / f"loop_backup_v{iteration}"
        backup_files(backup_dir)
        apply_changes(result["changes"])

        print("  Re-benchmarking after changes...", flush=True)
        new_csv = SCRIPTS_DIR / f"loop_v{iteration}.csv"
        try:
            new_accuracy = run_benchmark(new_csv)
        except RuntimeError as exc:
            print(f"  Benchmark error: {exc}\n  Reverting...")
            revert_from_backup(backup_dir)
            stop_reason = "benchmark failed after applying changes (reverted)"
            break

        improvement = new_accuracy - current_accuracy
        sign = "+" if improvement >= 0 else ""
        note = f"({sign}{improvement:.0%})  {result['reasoning'][:55]}"
        history.append((new_accuracy, note))
        print(f"  Result: {new_accuracy:.0%}  ({sign}{improvement:.0%})", flush=True)

        # Regression guard — revert and stop
        if new_accuracy < current_accuracy:
            print("  Regression — reverting changes")
            revert_from_backup(backup_dir)
            stop_reason = (
                f"regression at iteration {iteration} "
                f"(accuracy dropped {improvement:.0%}, changes reverted)"
            )
            break

        # Changes were at least neutral — keep them
        last_good_csv = new_csv
        current_accuracy = new_accuracy

        # Stopping conditions
        if current_accuracy >= ACCURACY_TARGET:
            stop_reason = f"accuracy target reached ({current_accuracy:.0%})"
            break

        if improvement < PLATEAU_THRESHOLD:
            stop_reason = (
                f"plateau — improvement {improvement:.0%} "
                f"is below {PLATEAU_THRESHOLD:.0%} threshold"
            )
            break

        # Re-check time after the full iteration
        if time.time() - start_time >= MAX_DURATION_SECONDS:
            stop_reason = "time limit reached (30 minutes)"
            break

    # ── Summary ─────────────────────────────────────────────────────────────
    _print_stop(stop_reason or "unknown")

    if stop_reason and stop_reason.startswith("accuracy target"):
        print(f"\n  Final accuracy : {current_accuracy:.0%}")
        print(f"  Iterations     : {iteration}")
        print("\n  Accuracy progression:")
        for i, (acc, note) in enumerate(history):
            label = "baseline" if i == 0 else f"  iter {i:>2}"
            print(f"    {label}:  {acc:.0%}  {note}")
    else:
        _print_bottleneck_report(last_good_csv, stop_reason or "unknown", history)


if __name__ == "__main__":
    main()
