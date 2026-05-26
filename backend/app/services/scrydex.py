"""Scrydex API client — fetches card prices (raw + graded) from api.scrydex.com."""

import logging
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

from app.db.session import settings

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.scrydex.com/pokemon/v1/cards"
_TIMEOUT = 10

# ---------------------------------------------------------------------------
# Currency conversion
# ---------------------------------------------------------------------------

_RATE_CACHE_TTL = 3600  # seconds
_rate_cache: Dict[str, Tuple[float, float]] = {}  # currency -> (rate, timestamp)

# Hardcoded fallbacks used when the exchange rate API is unreachable
_FALLBACK_RATES: Dict[str, float] = {
    "JPY": 0.0067,   # ~149 JPY per USD
    "EUR": 1.08,
    "GBP": 1.27,
    "KRW": 0.00073,
}


def _usd_rate(from_currency: str) -> Optional[float]:
    """Return the rate such that: amount_in_from_currency * rate = amount_in_USD.

    Cached for _RATE_CACHE_TTL seconds; falls back to hardcoded rates on error.
    """
    if from_currency == "USD":
        return 1.0

    now = time.time()
    cached = _rate_cache.get(from_currency)
    if cached and now - cached[1] < _RATE_CACHE_TTL:
        return cached[0]

    try:
        resp = requests.get(
            f"https://api.frankfurter.app/latest?from={from_currency}&to=USD",
            timeout=5,
        )
        resp.raise_for_status()
        rate: float = resp.json()["rates"]["USD"]
        _rate_cache[from_currency] = (rate, now)
        logger.info("Exchange rate %s→USD: %.6f", from_currency, rate)
        return rate
    except Exception as exc:
        logger.warning("Exchange rate fetch failed for %s: %s — using fallback", from_currency, exc)
        return _FALLBACK_RATES.get(from_currency)


def _to_usd(prices: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Return prices list with all non-USD entries converted to USD."""
    result = []
    for p in prices:
        currency = p.get("currency", "USD")
        if currency == "USD":
            result.append(p)
            continue

        rate = _usd_rate(currency)
        if rate is None:
            logger.warning("No conversion rate for %s — leaving price unconverted", currency)
            result.append(p)
            continue

        p = dict(p)
        for field in ("low", "mid", "high", "market"):
            if p.get(field) is not None:
                p[field] = round(p[field] * rate, 2)

        if "trends" in p and p["trends"]:
            converted_trends: Dict[str, Any] = {}
            for period, trend in p["trends"].items():
                if trend and "price_change" in trend:
                    converted_trends[period] = {
                        **trend,
                        "price_change": round(trend["price_change"] * rate, 2),
                    }
                else:
                    converted_trends[period] = trend
            p["trends"] = converted_trends

        p["currency"] = "USD"
        result.append(p)

    return result


def fetch_scrydex_prices(external_id: str) -> Optional[List[Dict[str, Any]]]:
    """Fetch all prices for a card from Scrydex, normalised to USD.

    Returns the combined prices list from all variants, or None on failure.
    """
    if not settings.scrydex_api_key or not settings.scrydex_team_id:
        logger.warning("Scrydex credentials not configured — skipping fetch for %s", external_id)
        return None
    try:
        resp = requests.get(
            f"{_BASE_URL}/{external_id}?include=prices",
            headers={
                "X-Api-Key": settings.scrydex_api_key,
                "X-Team-ID": settings.scrydex_team_id,
            },
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()["data"]
        prices: List[Dict[str, Any]] = []
        for variant in data.get("variants", []):
            prices.extend(variant.get("prices", []))
        return _to_usd(prices)
    except Exception as exc:
        logger.error("Scrydex fetch failed for %s: %s", external_id, exc)
        return None


# ---------------------------------------------------------------------------
# Condition/grade normalization
# ---------------------------------------------------------------------------

# Internal condition codes → Scrydex condition strings
_CONDITION_MAP: Dict[str, str] = {
    "nm":  "NM",
    "lp":  "LP",
    "mp":  "MP",
    "hp":  "HP",
    "dmg": "DM",
}


def _normalize_grade(grade: str) -> tuple:
    """Return (scrydex_grade_str, is_perfect) from our stored grade string.

    Handles BGS "10 (Black label)" / "10 (Gold label)" and
    CGC "10 (Pristine)" / "10 (Perfect)" / "10 (GM)".
    """
    g = grade.strip()
    if "(Black label)" in g:
        return g.replace(" (Black label)", "").strip(), True
    if "(Gold label)" in g:
        return g.replace(" (Gold label)", "").strip(), False
    if "(Pristine)" in g or "(Perfect)" in g:
        return g.split("(")[0].strip(), True
    if "(GM)" in g:
        return g.split("(")[0].strip(), False
    return g, False


def lookup_market_price(
    prices: List[Dict[str, Any]],
    condition_type: str,
    condition_ungraded: Optional[str],
    grading_company: Optional[str],
    grade: Optional[str],
) -> Optional[float]:
    """Return the Scrydex market price for the given inventory item condition.

    Returns None if no matching price entry is found.
    """
    if not prices:
        return None

    if condition_type == "ungraded" and condition_ungraded:
        target = _CONDITION_MAP.get(condition_ungraded.lower())
        if not target:
            return None
        for p in prices:
            if p.get("type") == "raw" and p.get("condition") == target:
                market = p.get("market")
                return float(market) if market is not None else None

    elif condition_type == "graded" and grading_company and grade:
        target_company = grading_company.upper()
        target_grade, target_perfect = _normalize_grade(grade)
        for p in prices:
            if (
                p.get("type") == "graded"
                and p.get("company", "").upper() == target_company
                and str(p.get("grade", "")) == target_grade
                and bool(p.get("is_perfect", False)) == target_perfect
                and not p.get("is_signed", False)
                and not p.get("is_error", False)
            ):
                market = p.get("market")
                return float(market) if market is not None else None

    return None
