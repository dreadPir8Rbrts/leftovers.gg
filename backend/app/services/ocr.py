"""
Google Cloud Vision OCR service.
Used by the Quick Scan endpoint to extract text from card images.
Credentials are loaded from GOOGLE_CREDENTIALS_BASE64 via Settings.

Performance notes:
- Uses ImageAnnotatorAsyncClient (native async gRPC, no thread pool overhead)
- Client is a module-level singleton — connection and auth established once
"""

import logging
import re
from typing import Optional, Dict, Any, List

from google.cloud import vision

logger = logging.getLogger(__name__)
from google.cloud.vision_v1 import (
    ImageAnnotatorAsyncClient,
    BatchAnnotateImagesRequest,
    AnnotateImageRequest,
    Feature,
    Image as VisionImage,
)

from app.db.session import settings


# Module-level singleton — created lazily on first request.
# Avoids re-establishing gRPC connection and re-decoding credentials per call.
_async_client: Optional[ImageAnnotatorAsyncClient] = None


def _get_async_client() -> ImageAnnotatorAsyncClient:
    global _async_client
    if _async_client is None:
        creds = settings.google_vision_credentials
        _async_client = (
            ImageAnnotatorAsyncClient(credentials=creds)
            if creds
            else ImageAnnotatorAsyncClient()
        )
    return _async_client


async def extract_card_text(image_bytes: bytes) -> Dict[str, Any]:
    """
    Send image to Google Cloud Vision and extract structured card fields.
    Returns a dict with keys: name, set_number, hp, illustrator.
    All values are strings / ints or None if not detected.
    Uses native async gRPC — no thread pool overhead.
    """
    client = _get_async_client()
    request = BatchAnnotateImagesRequest(
        requests=[
            AnnotateImageRequest(
                image=VisionImage(content=image_bytes),
                features=[Feature(type_=Feature.Type.TEXT_DETECTION)],
            )
        ]
    )
    response = await client.batch_annotate_images(request=request)
    annotation = response.responses[0]

    if annotation.error.message:
        raise RuntimeError(f"Google Vision error: {annotation.error.message}")

    if not annotation.text_annotations:
        return {"name": None, "set_number": None, "hp": None, "illustrator": None}

    raw_text = annotation.text_annotations[0].description
    logger.info("OCR raw text:\n%s", raw_text)
    return _parse_pokemon_card_text(raw_text)


# Lines that are never the card name when they appear alone.
# Covers: stage markers (digit and roman), Pocket-era "BASIC" standalone,
# VMAX, HP values, bare numbers, trainer/energy type headers,
# "STAGET" which is OCR noise for "STAGE 1",
# Japanese stage markers: 進化/1進化/2進化, たね (basic),
# and Japanese structural card labels that appear on every card:
#   にげる (retreat), 弱点 (weakness), 抵抗力 (resistance),
#   特性 (ability), ポケパワー (Pokémon Power), ポケボディー (Pokémon Body).
_NON_NAME_PATTERN = re.compile(
    r"^(STAGE(?:\s*\d+|\s*I{1,3}|T)?|BASIC|V\s*MAX|HP\s*\d+|\d+\s*HP|\d+|TRAINER|ENERGY"
    r"|\S{0,4}進化:?"  # stage markers: 進化, 1進化, 2進化, ⑦進化: (OCR noise for 1進化, trailing colon)
    r"|\d*進\S*"      # garbled stage markers: 2進な, 2進, 進な, 進化ポケモン, 2進化ポケモン, etc.
    r"|たね|にげる|弱点|抵抗力|特性|ポケパワー|ポケボディー"
    r"|No\.\s*\d+)$", # Pokédex/card number line (e.g. "No.084") — never a card name
    re.IGNORECASE,
)

# Inline prefix: stage/type printed on the same line as the Pokémon name.
# Matches "BASIC Pikachu", "STAGE 1 Raichu", "STAGE Electrode" (Pocket cards).
# Group 1 captures the remainder which may be the actual name.
_INLINE_PREFIX_PATTERN = re.compile(
    r"^(?:BASIC|STAGE(?:\s*\d+|\s*I{1,3}|T)?)\s+(.+)$",
    re.IGNORECASE,
)

# Lines to skip entirely — appear before the name on old-format cards.
# Also skips Japanese "Evolves from X" lines: "ヒトカゲから進化" etc.
# Lines ending with 。 are Japanese sentences (rule text, flavor text, attack text)
# and are never card names — e.g. Team Rocket boilerplate "モンスターカードに重ねて使います。"
# ".+進化させます。?" catches the full evolution instruction on Gen 1-2 stage cards.
# "「.*進化ポケモン.*" catches truncated fragments OCR produces when the instruction
# wraps or is partially obscured: "「進化ポケモン」の", "「1進化ポケモン」", etc.
_SKIP_LINE_PATTERN = re.compile(
    r"^(?:E(?:vo|va)lves?\s+from|.+から(?:進化)?|.+。|.+進化させます。?|「.*進化ポケモン.*)$",
    re.IGNORECASE,
)

# Level indicators appended to names on DPt/Platinum era and older cards.
# Strips: " LV.49", " Lv.49", " x.15", " V.9", " .44"
# Does NOT strip: "Pokémon V" (no dot/number), "VMAX" (no dot), "GL", "GX"
_LEVEL_SUFFIX_PATTERN = re.compile(
    r"\s+(?:LV|Lv)\.\s*\d+$"
    r"|\s+x\.\d+$"
    r"|\s+V\.\d+$"
    r"|\s+\.\d+$",
    re.IGNORECASE,
)


def _strip_level_indicator(name: str) -> str:
    """Remove trailing level indicators from an OCR-extracted name."""
    return _LEVEL_SUFFIX_PATTERN.sub("", name).strip()


def _detect_language(raw_text: str) -> str:
    """Return 'JA' if any Japanese Unicode characters are present, else 'EN'.
    Hiragana (U+3040–U+309F), Katakana (U+30A0–U+30FF), CJK (U+4E00–U+9FFF)
    are unambiguous markers — English cards never contain them.
    """
    for c in raw_text:
        cp = ord(c)
        if 0x3040 <= cp <= 0x309F or 0x30A0 <= cp <= 0x30FF or 0x4E00 <= cp <= 0x9FFF:
            return "JA"
    return "EN"


# HP noise: Vision sometimes reads the HP value (and adjacent type symbol) onto
# the same line as the card name because they share the same horizontal band.
# e.g. "Team Rocket's Zapdos 1204" where "120" = HP and "4" = ⚡ OCR noise.
# On old-era JA cards (Base–Neo) the level is also on the name line, so OCR
# can produce "わるいゲンガー M.3 HP70" where "M.3" is garbled "LV.32".
# The second alternative strips "HP<digits>" with an optional preceding level
# token (1-3 ASCII letters + dot + digits, e.g. "LV.32", "Lv.12", "M.3").
_HP_SUFFIX_PATTERN = re.compile(
    r"\s+\d{2,4}$"
    r"|\s+(?:\S{1,6}\s+)?HP\s*\d{2,3}\d?$",
    re.IGNORECASE,
)


def _strip_hp_suffix(name: str) -> str:
    """Remove a trailing HP value (+ possible OCR noise digit) from a name."""
    return _HP_SUFFIX_PATTERN.sub("", name).strip()


def _collect_name_candidates(lines: List[str]) -> List[str]:
    """
    Return all OCR lines that could be the card name — every line that passes
    the noise filters — in top-to-bottom order. Used by Quick Scan v3 so the
    matcher can try multiple candidates instead of committing to one.
    """
    candidates: List[str] = []
    seen: set = set()
    for line in lines:
        if _SKIP_LINE_PATTERN.match(line):
            continue
        inline = _INLINE_PREFIX_PATTERN.match(line)
        candidate = inline.group(1).strip() if inline else line
        if _NON_NAME_PATTERN.match(candidate):
            continue
        candidate = _strip_hp_suffix(_strip_level_indicator(candidate)).strip()
        if len(candidate) < 2:
            continue
        key = candidate.lower()
        if key not in seen:
            seen.add(key)
            candidates.append(candidate)
    return candidates


def _parse_pokemon_card_text(raw_text: str) -> Dict[str, Any]:
    """
    Extract structured fields from raw OCR text.
    Card name is the first line that isn't a stage marker, HP value, bare number,
    trainer/energy header, or level indicator. Handles:
      - Inline prefixes: "BASIC Pikachu" → "Pikachu" (Pocket card layout)
      - Level suffixes: "Aron x.15" → "Aron", "Bronzong LV.49" → "Bronzong"
      - Evolves-from lines: skipped (appear before name on Base Set era cards)
      - Roman numeral stages: "STAGE I" treated as noise like "STAGE 1"
    Set number matches NNN/NNN or TGxx/TGxx patterns.
    HP matches a number adjacent to 'HP'.
    Illustrator follows 'illus.' prefix.
    name_candidates: all non-noise lines (used by Quick Scan v3).
    """
    lines = [line.strip() for line in raw_text.split("\n") if line.strip()]
    result: Dict[str, Any] = {
        "name": None,
        "name_candidates": _collect_name_candidates(lines),
        "set_number": None,
        "ocr_num1": None,   # first part of set number e.g. "044" from "044/191"
        "ocr_num2": None,   # second part of set number e.g. "191" from "044/191"
        "hp": None,
        "illustrator": None,
        "language_code": _detect_language(raw_text),
    }

    for line in lines:
        # Skip "Evolves from" / "Evalves from" lines — appear before name on
        # Base Set era cards where OCR reads the evolution text first.
        if _SKIP_LINE_PATTERN.match(line):
            continue

        # Inline prefix: "BASIC Pikachu", "STAGE 1 Raichu", "STAGE Electrode"
        # Common on Pokémon TCG Pocket cards where stage and name share a line.
        inline = _INLINE_PREFIX_PATTERN.match(line)
        if inline:
            candidate = _strip_level_indicator(inline.group(1).strip())
            if not _NON_NAME_PATTERN.match(candidate):
                result["name"] = _strip_hp_suffix(candidate)
                break
            continue  # both tokens are noise (e.g. "BASIC TRAINER") — keep searching

        # Standard path: skip stage markers, HP, bare numbers, type headers.
        if not _NON_NAME_PATTERN.match(line):
            result["name"] = _strip_hp_suffix(_strip_level_indicator(line))
            break

    # Allow up to 4 digits on the right side — OCR sometimes appends an extra
    # character to the card count (e.g. "044/1910" instead of "044/191").
    # Two-pass set number extraction — slash formats take priority over No.NNN.
    # Pass 1: NNN/NNN, TG##/TG##, NNN/XX-P — the explicit slash set number.
    # Pass 2: No.NNN (1-3 digits only) — vintage JA Base-era card numbers.
    # Keeping them separate prevents the Pokédex species line ("NO. 0523
    # Thunderbolt Pokémon HT 5'3"…") from shadowing the real set number
    # ("063/182") that appears lower in the OCR output. Modern Pokédex entries
    # always use 4-digit numbers (0523, 0036), so the 3-digit cap on No. is safe.
    # Rarity codes (AR, SAR, SR …) are absorbed by (?:[A-Z]{0,4}) so group(1)
    # is the clean numeric portion without the rarity suffix.
    _slash_pattern = re.compile(
        r"\b(\d{1,3}/\d{1,4}|TG\d+/TG\d+|\d{1,3}/[A-Z]{1,6}-[A-Z])(?:[A-Z]{0,4})\b",
        re.IGNORECASE,
    )
    _no_pattern = re.compile(r"\b(No\.\s*\d{1,3})\b", re.IGNORECASE)
    # OCR frequently corrupts "No." → "Na", "Nu", "Nc" etc. (o misread as a/u/c).
    # Captures just the digits so normalization is the same as Pass 2.
    _no_corrupt_pattern = re.compile(r"\bN[a-z]\.?\s+(\d{1,3})\b", re.IGNORECASE)

    for line in lines:
        m = _slash_pattern.search(line)
        if m:
            result["set_number"] = m.group(1)
            parts = m.group(1).split("/")
            result["ocr_num1"] = parts[0] if len(parts) > 0 else None
            result["ocr_num2"] = parts[1] if len(parts) > 1 else None
            break

    if result["set_number"] is None:
        for line in lines:
            m = _no_pattern.search(line)
            if m:
                # Normalize "No. 075" → "No.075": remove the optional space the OCR
                # sometimes inserts between "No." and the digits so the string matches
                # the DB printed_number format exactly.
                digits = m.group(1)[3:].strip()
                normalized = f"No.{digits}"
                result["set_number"] = normalized
                result["ocr_num1"] = normalized
                result["ocr_num2"] = None
                break

    # Pass 2b: OCR-corrupted No. prefix (e.g. "Na 097" → "No.097")
    if result["set_number"] is None:
        for line in lines:
            m = _no_corrupt_pattern.search(line)
            if m:
                digits = m.group(1).strip()
                normalized = f"No.{digits}"
                result["set_number"] = normalized
                result["ocr_num1"] = normalized
                result["ocr_num2"] = None
                break

    # Pass 3: standalone zero-padded 3-digit numbers ("007", "036") — Topsun and
    # Vending-era JA cards where the card number is printed alone with no slash total.
    # Restricted to exactly 3 characters so HP, damage values, and years never match.
    if result["set_number"] is None:
        for line in lines:
            if re.match(r"^0\d{2}$", line):
                result["set_number"] = line
                result["ocr_num1"] = line
                result["ocr_num2"] = None
                break

    # Search the full raw text (not line-by-line) so "HP\n100" is matched
    # even when the number appears on the line after the HP label.
    # Allow an optional trailing noise digit (e.g. "1204" where ⚡ → "4")
    # by matching \d{2,3} followed by an optional extra digit before/after the HP label.
    #
    # Try "HP 50" (HP-prefix) first, then fall back to "50 HP" (HP-suffix).
    # Searching jointly with | would return leftmost match — on a line like
    # "LV.15 HP 50", "15 HP" starts earlier than "HP 50" and would win incorrectly.
    hp_prefix = re.search(r"\bHP\s*(\d{2,3})\d?\b", raw_text, re.IGNORECASE)
    if hp_prefix:
        result["hp"] = int(hp_prefix.group(1))
    else:
        hp_suffix = re.search(r"\b(\d{2,3})\d?\s*HP\b", raw_text, re.IGNORECASE)
        if hp_suffix:
            result["hp"] = int(hp_suffix.group(1))

    # Broad illustrator pattern — OCR frequently corrupts the "Illus." prefix:
    #   "lus.Nobuyuki Hobu"  (Il dropped)
    #   "Hlus. Hikaru Koike" (I→H, l dropped)
    #   "Illus Hikaru Koike" (dot dropped)
    # Anchored to the start of the line: 0–4 ASCII letters before "lus",
    # optional dot, then the artist name. The ^ anchor prevents mid-sentence
    # words ending in "lus" (e.g. attack text) from being matched.
    illus_pattern = re.compile(r"^[A-Za-z]{0,4}lus\.?\s*(.+)", re.IGNORECASE)
    for line in lines:
        match = illus_pattern.match(line)
        if match:
            artist = match.group(1).strip()
            # Strip trailing copyright block: "Benimaru Itoh ©1995..." → "Benimaru Itoh"
            copy_idx = artist.find("©")
            if copy_idx > 0:
                artist = artist[:copy_idx].strip()
            result["illustrator"] = artist
            break

    return result


# ---------------------------------------------------------------------------
# Naruto CCG OCR parsing
# ---------------------------------------------------------------------------

# Lines to skip when looking for the card name on a Naruto card.
# Covers: edition markers, pure numbers, copyright, stat pipe lines,
# game-mechanic keyword starters, symbol-only lines, score boxes.
_NARUTO_SKIP = re.compile(
    r"^(1st Edition|2nd Edition|\d+|©|Requirements?:|Effect:|Valid:|Even:|Odd:|"
    r"[XO]$|0/X|X/0|\[|●|NINJA|JUTSU|MISSION|CLIENT|PERMANENT)",
    re.IGNORECASE,
)

# Matches flavor text / sound effects where a character repeats 5+ times (e.g. "Grrrrrrrr")
_REPEATED_CHAR = re.compile(r"(.)\1{4,}")


def _parse_naruto_card_text(raw_text: str) -> Dict[str, Any]:
    """
    Extract card number and name from raw OCR text of a Naruto CCG card.

    Card number: 3-4 digit number on the ID/copyright line.
      Every Naruto card bottom line looks like:
        術 772 S19 ©2002MK · 2007SP ● ● ●   (Jutsu format)
        忍 1205 TP3 ©2002MK · 2007SP ● ● ●  (Ninja format)
      We find the line containing '©' and extract the first 3-4 digit number.

    Card name: first non-noise line. On Ninja cards the name is near the top
      of the card so it appears early in OCR output. On Jutsu cards the name
      sits in the center but is still the largest non-mechanic text present.
    """
    lines = [l.strip() for l in raw_text.split("\n") if l.strip()]

    card_number: Optional[str] = None
    name: Optional[str] = None

    # --- Card number: find the © line and grab the 3-4 digit number ---
    for line in lines:
        if "©" in line or "2002" in line:
            m = re.search(r"\b(\d{3,4})\b", line)
            if m:
                card_number = m.group(1)
                break

    # Fallback: lone 3-4 digit number on its own line
    if card_number is None:
        for line in lines:
            if re.fullmatch(r"\d{3,4}", line):
                card_number = line
                break

    # --- Card name: first clean line ---
    for line in lines:
        if len(line) < 2:
            continue
        if _NARUTO_SKIP.match(line):
            continue
        if "©" in line or "2002MK" in line or "2007SP" in line:
            continue
        # Skip quoted flavor text or sound effects (e.g. OCR drops the leading “ from “Grrrrrr”)
        if line[0] in ('"', '“', '”', "'", '‘', '’'):
            continue
        if _REPEATED_CHAR.search(line):
            continue
        # Skip stat/attribute pipe lines: "Akatsuki | Rain | Male | ..."
        if " | " in line:
            continue
        # Skip score/combat boxes like "0/X" handled by regex but also "X/0", "7 1"
        if re.fullmatch(r"[\dX/\s]+", line):
            continue
        name = line
        break

    return {"card_number": card_number, "name": name}


async def extract_naruto_card_text(image_bytes: bytes) -> Dict[str, Any]:
    """
    Send image to Google Cloud Vision and extract Naruto CCG card fields.
    Returns {"card_number": str|None, "name": str|None}.
    """
    client = _get_async_client()
    request = BatchAnnotateImagesRequest(
        requests=[
            AnnotateImageRequest(
                image=VisionImage(content=image_bytes),
                features=[Feature(type_=Feature.Type.TEXT_DETECTION)],
            )
        ]
    )
    response = await client.batch_annotate_images(request=request)
    annotation = response.responses[0]

    if annotation.error.message:
        raise RuntimeError(f"Google Vision error: {annotation.error.message}")

    if not annotation.text_annotations:
        return {"card_number": None, "name": None}

    raw_text = annotation.text_annotations[0].description
    logger.info("Naruto OCR raw text:\n%s", raw_text)
    return _parse_naruto_card_text(raw_text)
