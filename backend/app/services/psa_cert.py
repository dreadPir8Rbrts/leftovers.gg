"""
PSA cert page scraper.

Fetches https://www.psacard.com/cert/{cert_number} and extracts:
  card_name     — e.g. "Machoke"
  card_number   — e.g. "34"
  language_code — "ja" or "en"
  year          — e.g. "1998"
  grade         — e.g. "9" (when present)
  raw_description — the full description string from PSA

Multiple extraction strategies are tried in order:
  1. __NEXT_DATA__ JSON blob (Next.js SSR — most reliable when present)
  2. JSON-LD structured data
  3. Open Graph meta tags (og:title / og:description)
  4. HTML <title> tag

Returns a dict on success. Raises RuntimeError on fetch/parse failure.
"""

import json
import logging
import re
from typing import Optional

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

_PSA_CERT_URL = "https://www.psacard.com/cert/{cert_number}"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

_JAPANESE_KEYWORDS = frozenset({"japanese", "japanese-language", "japan"})


async def fetch_psa_cert(cert_number: str) -> dict:
    """
    Fetch and parse a PSA cert page.

    Returns a dict with keys:
      card_name, card_number, language_code, year, grade (optional),
      raw_description

    Raises RuntimeError if the cert cannot be fetched or parsed.
    """
    url = _PSA_CERT_URL.format(cert_number=cert_number)
    logger.info("psa_cert: fetching %s", url)

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=12.0) as client:
            resp = await client.get(url, headers=_HEADERS)
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(
            f"PSA cert page returned HTTP {exc.response.status_code} for cert {cert_number}"
        ) from exc
    except httpx.RequestError as exc:
        raise RuntimeError(f"PSA cert page request failed: {exc}") from exc

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
            # Strip common suffixes like " | PSA" or " - PSAcard.com"
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

    # Try common key names for the cert object
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

    # Also try top-level pageProps keys in case cert data is inlined
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

    Returns: card_name, card_number, language_code, year
    """
    text = description.strip()

    # Year — 4 digits at the start
    year_match = re.match(r"^(\d{4})\b", text)
    year = year_match.group(1) if year_match else None

    # Card number — #NNN or #NNN/TTT (capture NNN only)
    card_num_match = re.search(r"#(\d+)(?:/\d+)?", text)
    card_number = card_num_match.group(1) if card_num_match else None

    # Language
    lower = text.lower()
    language_code = "ja" if any(kw in lower for kw in _JAPANESE_KEYWORDS) else "en"

    # Card name: everything after the last #NNN[/TTT], stripped of set-number suffixes
    card_name: Optional[str] = None
    if card_num_match:
        after_num = text[card_num_match.end():].strip()
        # Strip leading /NNN (total count after slash, e.g. "/190")
        after_num = re.sub(r"^/\d+\s*", "", after_num).strip()
        if after_num:
            # Take up to the first " - " (PSA sometimes appends variant info)
            card_name = after_num.split(" - ")[0].strip()

    # Fallback: last word(s) of the description
    if not card_name:
        # Try to grab the last capitalised word sequence (likely the Pokémon name)
        words = text.split()
        # Walk backwards to skip short tokens like "PSA", "9", etc.
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
