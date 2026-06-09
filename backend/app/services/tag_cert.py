"""
TAG grading cert lookup via the TAG public API.

GET https://api.taggrading.com/graded-cards/public/detail/{cert_number}
Requires headers: x-tag-key, Origin: https://my.taggrading.com

Returns the same dict shape as psa_cert.fetch_psa_cert:
  card_name, card_number, language_code, year, grade, raw_description

Raises RuntimeError on fetch/parse failure.
"""

import logging
import re
from typing import Optional

import httpx

from app.db.session import settings

logger = logging.getLogger(__name__)

_TAG_API_URL = "https://api.taggrading.com/graded-cards/public/detail/{cert_number}"
_TAG_ORIGIN = "https://my.taggrading.com"

_JAPANESE_KEYWORDS = frozenset({"japanese", "japan", "jp"})


async def fetch_tag_cert(cert_number: str) -> dict:
    """
    Fetch and parse a TAG cert via the TAG public API.
    Raises RuntimeError on fetch/parse failure.
    """
    if not settings.tag_api_key:
        raise RuntimeError("TAG_API_KEY is not configured on this server")

    url = _TAG_API_URL.format(cert_number=cert_number)
    logger.info("tag_cert: calling TAG API for cert %s", cert_number)

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(
                url,
                headers={
                    "x-tag-key": settings.tag_api_key,
                    "Origin": _TAG_ORIGIN,
                    "Referer": f"{_TAG_ORIGIN}/",
                    "Accept": "application/json, text/plain, */*",
                    "Accept-Language": "en-US,en;q=0.9",
                    "User-Agent": (
                        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                        "AppleWebKit/605.1.15 (KHTML, like Gecko) "
                        "Version/17.0 Mobile/15E148 Safari/604.1"
                    ),
                    "sec-fetch-site": "same-site",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-dest": "empty",
                },
            )
    except httpx.RequestError as exc:
        raise RuntimeError(f"TAG API request failed: {exc}") from exc

    if resp.status_code == 404:
        raise RuntimeError(f"TAG cert {cert_number} not found")
    if resp.status_code == 403:
        raise RuntimeError(f"TAG API returned 403 for cert {cert_number} — key may be invalid")

    try:
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(
            f"TAG API returned HTTP {exc.response.status_code} for cert {cert_number}"
        ) from exc

    try:
        data = resp.json()
    except Exception as exc:
        raise RuntimeError(f"TAG API response was not valid JSON for cert {cert_number}") from exc

    logger.info("tag_cert: raw response for cert %s: %s", cert_number, data)
    return _parse_tag_response(data, cert_number)


def _parse_tag_response(data: dict, cert_number: str) -> dict:
    # Unwrap common envelope shapes
    card = data.get("data") or data.get("card") or data.get("gradedCard") or data
    if not isinstance(card, dict):
        raise RuntimeError(f"TAG API returned unexpected response shape for cert {cert_number}")

    # Card name — try various field names
    card_name: Optional[str] = (
        card.get("cardName") or card.get("card_name") or
        card.get("name") or card.get("title") or
        card.get("cardTitle") or card.get("subject")
    )
    if not card_name:
        # Sometimes nested under a 'card' sub-object
        nested = card.get("card") or card.get("cardInfo") or {}
        if isinstance(nested, dict):
            card_name = (
                nested.get("cardName") or nested.get("name") or
                nested.get("title") or nested.get("subject")
            )

    if not card_name:
        raise RuntimeError(f"TAG API returned no card name for cert {cert_number}")

    # Card number
    card_number: Optional[str] = str(
        card.get("cardNumber") or card.get("card_number") or
        card.get("number") or card.get("localId") or ""
    ).lstrip("0") or None

    # Grade
    grade_raw = (
        card.get("grade") or card.get("finalGrade") or
        card.get("overallGrade") or card.get("cardGrade") or
        card.get("gradeName") or card.get("gradeValue")
    )
    grade: Optional[str] = str(grade_raw).strip() if grade_raw is not None else None

    # Year
    year_raw = (
        card.get("year") or card.get("cardYear") or
        card.get("releaseYear") or card.get("setYear")
    )
    year: Optional[str] = str(year_raw).strip() if year_raw else None

    # Set/series name for raw_description
    set_name: Optional[str] = (
        card.get("setName") or card.get("set_name") or
        card.get("series") or card.get("expansion") or
        card.get("groupName") or card.get("productName")
    )

    # Language detection
    lang_raw = str(
        card.get("language") or card.get("languageName") or
        card.get("languageCode") or card.get("lang") or ""
    ).lower()
    language_code = "ja" if any(kw in lang_raw for kw in _JAPANESE_KEYWORDS) else "en"
    if language_code == "en":
        # Also check card name / set name for Japanese keywords
        combined = f"{card_name} {set_name or ''}".lower()
        if any(kw in combined for kw in _JAPANESE_KEYWORDS):
            language_code = "ja"

    raw_description = " ".join(filter(None, [year, set_name, card_name]))

    result: dict = {
        "card_name": card_name.strip(),
        "card_number": card_number,
        "language_code": language_code,
        "year": year,
        "raw_description": raw_description or card_name,
    }
    if grade:
        result["grade"] = grade

    logger.info("tag_cert: cert %s → %s", cert_number, result)
    return result
