"""
PSA cert lookup with automatic fallback.

Primary path (up to 100 req/day):
  PSA public JSON API — api.psacard.com/publicapi/cert/GetByCertNumber/{cert}
  Counter stored in Redis; TTL set to seconds until midnight UTC so the
  quota resets on the same calendar boundary PSA uses.

Fallback path (once the daily quota is exhausted, or if PSA_API_KEY is unset):
  Bright Data Web Unlocker — POSTs the PSA cert page URL to
  api.brightdata.com/request and parses the returned HTML.

Both paths return the same dict:
  card_name, card_number, language_code, year, grade (optional),
  raw_description

Raises RuntimeError on fetch/parse failure.
"""

import json
import logging
import re
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
import redis.asyncio as aioredis
from bs4 import BeautifulSoup

from app.db.session import settings

logger = logging.getLogger(__name__)

_PSA_CERT_URL = "https://www.psacard.com/cert/{cert_number}/psa"
_PSA_API_URL = "https://api.psacard.com/publicapi/cert/GetByCertNumber/{cert_number}"
_BRIGHTDATA_ENDPOINT = "https://api.brightdata.com/request"
_BRIGHTDATA_ZONE = "cardops_scraper"

_PSA_DAILY_LIMIT = 100
_PSA_COUNTER_KEY = "psa_cert_api:daily_count"

_JAPANESE_KEYWORDS = frozenset({"japanese", "japanese-language", "japan"})


# ---------------------------------------------------------------------------
# Redis counter helpers
# ---------------------------------------------------------------------------

def _seconds_until_midnight_utc() -> int:
    now = datetime.now(timezone.utc)
    midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((midnight - now).total_seconds()))


async def _psa_api_count() -> int:
    """Return today's PSA public API usage count (0 if key not set)."""
    try:
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        async with r:
            val = await r.get(_PSA_COUNTER_KEY)
        return int(val) if val else 0
    except Exception as exc:
        logger.warning("psa_cert: could not read Redis counter: %s", exc)
        return 0


async def _increment_psa_api_count() -> None:
    """Increment today's counter; set TTL to midnight UTC on first use."""
    try:
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        async with r:
            ttl = _seconds_until_midnight_utc()
            pipe = r.pipeline()
            pipe.incr(_PSA_COUNTER_KEY)
            pipe.expire(_PSA_COUNTER_KEY, ttl, xx=False)  # only set TTL if not already set
            await pipe.execute()
    except Exception as exc:
        logger.warning("psa_cert: could not increment Redis counter: %s", exc)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def fetch_psa_cert(cert_number: str, force_method: Optional[str] = None) -> dict:
    """
    Fetch and parse a PSA cert.

    force_method: "psa_api" | "brightdata" | None
      None  → automatic: PSA API up to daily limit, then Web Unlocker
      "psa_api"   → PSA public API only (bypasses counter check)
      "brightdata" → Web Unlocker only (bypasses PSA API)

    Returns a dict with keys:
      card_name, card_number, language_code, year, grade (optional),
      raw_description

    Raises RuntimeError if the chosen path fails.
    """
    if force_method == "brightdata":
        logger.info("psa_cert: forced to Web Unlocker for cert %s", cert_number)
        return await _fetch_via_web_unlocker(cert_number)

    if force_method == "psa_api":
        logger.info("psa_cert: forced to PSA public API for cert %s", cert_number)
        return await _try_psa_public_api(cert_number)

    # Automatic path: PSA API up to daily limit, then Web Unlocker
    if settings.psa_access_token:
        count = await _psa_api_count()
        if count < _PSA_DAILY_LIMIT:
            logger.info("psa_cert: using PSA public API (count %d/%d)", count, _PSA_DAILY_LIMIT)
            try:
                result = await _try_psa_public_api(cert_number)
                await _increment_psa_api_count()
                return result
            except _PSARateLimitError:
                logger.warning(
                    "psa_cert: PSA API returned rate limit for cert %s — falling back to Web Unlocker",
                    cert_number,
                )
            except RuntimeError as exc:
                logger.warning(
                    "psa_cert: PSA API failed for cert %s (%s) — falling back to Web Unlocker",
                    cert_number, exc,
                )
        else:
            logger.info(
                "psa_cert: daily quota reached (%d/%d) — using Web Unlocker",
                count, _PSA_DAILY_LIMIT,
            )

    return await _fetch_via_web_unlocker(cert_number)


# ---------------------------------------------------------------------------
# PSA public API path
# ---------------------------------------------------------------------------

class _PSARateLimitError(RuntimeError):
    pass


async def _try_psa_public_api(cert_number: str) -> dict:
    url = _PSA_API_URL.format(cert_number=cert_number)
    logger.info("psa_cert: calling PSA public API for cert %s", cert_number)

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(
                url,
                headers={
                    "Authorization": f"Bearer {settings.psa_access_token}",
                    "Accept": "application/json",
                },
            )
    except httpx.RequestError as exc:
        raise RuntimeError(f"PSA API request failed: {exc}") from exc

    if resp.status_code == 429:
        raise _PSARateLimitError("PSA API rate limit hit")
    if resp.status_code == 403:
        raise _PSARateLimitError(f"PSA API returned 403 for cert {cert_number} (quota may be exhausted)")

    try:
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(
            f"PSA API returned HTTP {exc.response.status_code} for cert {cert_number}"
        ) from exc

    try:
        data = resp.json()
    except Exception as exc:
        raise RuntimeError(f"PSA API response was not valid JSON for cert {cert_number}") from exc

    return _parse_psa_api_response(data, cert_number)


def _parse_psa_api_response(data: dict, cert_number: str) -> dict:
    cert = data.get("PSACert") or data.get("psaCert") or data
    if not cert or not isinstance(cert, dict):
        raise RuntimeError(f"PSA API returned no cert data for cert {cert_number}")

    subject: Optional[str] = (
        cert.get("Subject") or cert.get("subject") or
        cert.get("Name") or cert.get("name")
    )
    if not subject:
        raise RuntimeError(f"PSA API returned no card description for cert {cert_number}")

    card_number: Optional[str] = str(
        cert.get("CardNumber") or cert.get("cardNumber") or cert.get("card_number") or ""
    ).lstrip("0") or None

    grade_raw = (
        cert.get("Grade") or cert.get("grade") or
        cert.get("CardGrade") or cert.get("PSAGrade")
    )
    grade: Optional[str] = str(grade_raw).strip() if grade_raw else None

    year_raw = cert.get("Year") or cert.get("year")
    year: Optional[str] = str(year_raw).strip() if year_raw else None

    variety: Optional[str] = cert.get("Variety") or cert.get("variety") or ""
    raw_description = f"{year} {subject}" if year else subject
    if variety:
        raw_description = f"{raw_description} {variety}"

    lower = subject.lower()
    language_code = "ja" if any(kw in lower for kw in _JAPANESE_KEYWORDS) else "en"

    # Subject from the API is already the card name; strip any embedded #NNN if present
    card_name = subject.strip()
    num_match = re.search(r"#\d+(?:/\d+)?\s*", card_name)
    if num_match:
        extracted_num = re.search(r"#(\d+)", subject)
        if extracted_num and not card_number:
            card_number = extracted_num.group(1)
        card_name = card_name[num_match.end():].strip()

    result: dict = {
        "card_name": card_name or subject,
        "card_number": card_number,
        "language_code": language_code,
        "year": year,
        "raw_description": raw_description,
    }
    if grade:
        result["grade"] = grade

    logger.info("psa_cert: cert %s → %s (via PSA API)", cert_number, result)
    return result


# ---------------------------------------------------------------------------
# Bright Data Web Unlocker path
# ---------------------------------------------------------------------------

async def _fetch_via_web_unlocker(cert_number: str) -> dict:
    if not settings.brightdata_api:
        raise RuntimeError(
            "PSA daily quota exhausted and BRIGHTDATA_API is not configured"
        )

    url = _PSA_CERT_URL.format(cert_number=cert_number)
    logger.info("psa_cert: fetching %s via Web Unlocker", url)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                _BRIGHTDATA_ENDPOINT,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {settings.brightdata_api}",
                },
                json={"zone": _BRIGHTDATA_ZONE, "url": url, "format": "raw"},
            )
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(
            f"Web Unlocker returned HTTP {exc.response.status_code} for cert {cert_number}"
        ) from exc
    except httpx.RequestError as exc:
        raise RuntimeError(f"Web Unlocker request failed: {exc}") from exc

    return _parse_psa_page(resp.text, cert_number)


# ---------------------------------------------------------------------------
# HTML parser (used by Web Unlocker path)
# ---------------------------------------------------------------------------

def _normalize_psa_grade(grade_str: str) -> Optional[str]:
    """Extract the numeric grade from a PSA grade string e.g. 'MINT 9' → '9'."""
    m = re.search(r"(\d+(?:\.\d+)?)\s*$", grade_str.strip())
    return m.group(1) if m else grade_str.strip() or None


def _parse_psa_page(html: str, cert_number: str) -> dict:
    soup = BeautifulSoup(html, "lxml")

    # Strategy 0: <dl class="text-body1"> — direct dt/dd field extraction
    dl = soup.find("dl", class_="text-body1")
    if dl:
        fields: dict = {}
        for div in dl.find_all("div"):
            dt = div.find("dt")
            dd = div.find("dd")
            if dt and dd:
                key = dt.get_text(strip=True).lower()
                val = dd.get_text(separator=" ", strip=True)
                fields[key] = val

        subject = fields.get("subject", "").strip()
        if subject:
            brand = fields.get("brand/title", "")
            lower = (subject + " " + brand).lower()
            language_code = "ja" if any(kw in lower for kw in _JAPANESE_KEYWORDS) else "en"

            card_number = fields.get("card number", "").strip() or None
            year = fields.get("year", "").strip() or None
            grade_raw = fields.get("item grade", "").strip()
            grade = _normalize_psa_grade(grade_raw) if grade_raw else None
            variety = fields.get("variety/pedigree", "").strip() or None

            raw_description = " ".join(filter(None, [year, brand, subject]))

            result = {
                "card_name": subject,
                "card_number": card_number,
                "language_code": language_code,
                "year": year,
                "raw_description": raw_description,
            }
            if grade:
                result["grade"] = grade
            if variety:
                result["variety"] = variety

            logger.info("psa_cert: cert %s → %s (via Web Unlocker, dl parse)", cert_number, result)
            return result

    description: Optional[str] = None
    grade: Optional[str] = None

    # Strategy 1: __NEXT_DATA__ JSON blob (Next.js SSR)
    next_data_tag = soup.find("script", {"id": "__NEXT_DATA__"})
    if next_data_tag and next_data_tag.string:
        try:
            data = json.loads(next_data_tag.string)
            extracted = _extract_from_next_data(data)
            if extracted:
                description = extracted.get("description")
                grade = extracted.get("grade")
        except (json.JSONDecodeError, KeyError, TypeError):
            logger.debug("psa_cert: __NEXT_DATA__ parse failed for cert %s", cert_number)

    # Strategy 2: JSON-LD structured data
    if not description:
        for script in soup.find_all("script", {"type": "application/ld+json"}):
            try:
                ld = json.loads(script.string or "")
                name = ld.get("name") or ld.get("description") or ld.get("headline")
                if name and isinstance(name, str) and len(name) > 5:
                    description = name
                    break
            except (json.JSONDecodeError, AttributeError):
                pass

    # Strategy 3: Open Graph meta tags
    if not description:
        og_title = soup.find("meta", {"property": "og:title"})
        if og_title and og_title.get("content"):
            description = og_title["content"]
    if not description:
        og_desc = soup.find("meta", {"property": "og:description"})
        if og_desc and og_desc.get("content"):
            description = og_desc["content"]

    # Strategy 4: <title> tag (last resort)
    if not description:
        title_tag = soup.find("title")
        if title_tag:
            raw = title_tag.get_text(strip=True)
            description = re.split(r"\s*[\|–—-]\s*PSA", raw, flags=re.IGNORECASE)[0].strip()

    if not description:
        raise RuntimeError(
            f"Could not extract card description from PSA cert {cert_number} — "
            "page may be client-side rendered or the cert number is invalid"
        )

    parsed = _parse_psa_description(description)
    if grade:
        parsed["grade"] = grade
    parsed["raw_description"] = description

    logger.info("psa_cert: cert %s → %s (via Web Unlocker)", cert_number, parsed)
    return parsed


def _extract_from_next_data(data: dict) -> Optional[dict]:
    page_props = data.get("props", {}).get("pageProps", {})

    for key in ("cert", "certData", "certDetails", "psaCert", "PSACert", "certInfo"):
        cert = page_props.get(key)
        if cert and isinstance(cert, dict):
            desc = (
                cert.get("subject") or cert.get("Subject") or
                cert.get("description") or cert.get("Description") or
                cert.get("title") or cert.get("Title") or
                cert.get("name") or cert.get("Name")
            )
            grade = (
                cert.get("cardGrade") or cert.get("CardGrade") or
                cert.get("grade") or cert.get("Grade") or
                cert.get("psa_grade") or cert.get("PSAGrade")
            )
            if desc:
                return {"description": str(desc), "grade": str(grade) if grade else None}

    desc = (
        page_props.get("subject") or page_props.get("description") or
        page_props.get("cardTitle") or page_props.get("title")
    )
    if desc:
        grade = page_props.get("grade") or page_props.get("cardGrade")
        return {"description": str(desc), "grade": str(grade) if grade else None}

    return None


def _parse_psa_description(description: str) -> dict:
    text = description.strip()

    year_match = re.match(r"^(\d{4})\b", text)
    year = year_match.group(1) if year_match else None

    card_num_match = re.search(r"#(\d+)(?:/\d+)?", text)
    card_number = card_num_match.group(1) if card_num_match else None

    lower = text.lower()
    language_code = "ja" if any(kw in lower for kw in _JAPANESE_KEYWORDS) else "en"

    card_name: Optional[str] = None
    if card_num_match:
        after_num = text[card_num_match.end():].strip()
        after_num = re.sub(r"^/\d+\s*", "", after_num).strip()
        if after_num:
            card_name = after_num.split(" - ")[0].strip()

    if not card_name:
        words = text.split()
        name_parts = []
        for w in reversed(words):
            if re.match(r"^[A-Z][a-zA-Z\-\']+$", w):
                name_parts.insert(0, w)
            else:
                break
        card_name = " ".join(name_parts) if name_parts else (words[-1] if words else None)

    return {
        "card_name": card_name,
        "card_number": card_number,
        "language_code": language_code,
        "year": year,
    }
