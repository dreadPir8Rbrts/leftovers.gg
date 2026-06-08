"""
PSA cert page scraper via Bright Data Web Unlocker.

Fetches https://www.psacard.com/cert/{cert_number} through the Web Unlocker
API to bypass bot protection, then parses the HTML to extract:
  card_name, card_number, language_code, year, grade, raw_description

Multiple extraction strategies are tried in order:
  1. __NEXT_DATA__ JSON blob (Next.js SSR — most reliable when present)
  2. JSON-LD structured data
  3. Open Graph meta tags (og:title / og:description)
  4. HTML <title> tag

Raises RuntimeError on fetch/parse failure.
"""

import json
import logging
import re
from typing import Optional

import httpx
from bs4 import BeautifulSoup

from app.db.session import settings

logger = logging.getLogger(__name__)

_PSA_CERT_URL = "https://www.psacard.com/cert/{cert_number}"
_BRIGHTDATA_ENDPOINT = "https://api.brightdata.com/request"
_BRIGHTDATA_ZONE = "cardops_scraper"

_JAPANESE_KEYWORDS = frozenset({"japanese", "japanese-language", "japan"})


async def fetch_psa_cert(cert_number: str) -> dict:
    """
    Fetch and parse a PSA cert page via Bright Data Web Unlocker.

    Returns a dict with keys:
      card_name, card_number, language_code, year, grade (optional),
      raw_description

    Raises RuntimeError if the cert cannot be fetched or parsed.
    """
    if not settings.brightdata_api:
        raise RuntimeError("BRIGHTDATA_API is not configured on this server")

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


def _parse_psa_page(html: str, cert_number: str) -> dict:
    soup = BeautifulSoup(html, "lxml")

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

    # Strategy 4: <title> tag (last resort — often includes site name suffix)
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

    logger.info("psa_cert: cert %s → %s", cert_number, parsed)
    return parsed


def _extract_from_next_data(data: dict) -> Optional[dict]:
    """Walk __NEXT_DATA__ looking for cert description + grade fields."""
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
    """
    Parse a PSA card description like:
      "1998 Pokemon Japanese Vending Series II #34 Machoke"
    into structured fields.
    """
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
