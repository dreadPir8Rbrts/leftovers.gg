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
from typing import Optional, Dict, Any

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
# and "STAGET" which is OCR noise for "STAGE 1".
_NON_NAME_PATTERN = re.compile(
    r"^(STAGE(?:\s*\d+|\s*I{1,3}|T)?|BASIC|V\s*MAX|HP\s*\d+|\d+\s*HP|\d+|TRAINER|ENERGY)$",
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
_SKIP_LINE_PATTERN = re.compile(
    r"^(?:E(?:vo|va)lves?\s+from)",
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
    """
    lines = [line.strip() for line in raw_text.split("\n") if line.strip()]
    result: Dict[str, Any] = {
        "name": None,
        "set_number": None,
        "ocr_num1": None,   # first part of set number e.g. "044" from "044/191"
        "ocr_num2": None,   # second part of set number e.g. "191" from "044/191"
        "hp": None,
        "illustrator": None,
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
                result["name"] = candidate
                break
            continue  # both tokens are noise (e.g. "BASIC TRAINER") — keep searching

        # Standard path: skip stage markers, HP, bare numbers, type headers.
        if not _NON_NAME_PATTERN.match(line):
            result["name"] = _strip_level_indicator(line)
            break

    # Allow up to 4 digits on the right side — OCR sometimes appends an extra
    # character to the card count (e.g. "044/1910" instead of "044/191").
    set_number_pattern = re.compile(r"\b(\d{1,3}/\d{1,4}|TG\d+/TG\d+)\b")
    for line in lines:
        match = set_number_pattern.search(line)
        if match:
            result["set_number"] = match.group(0)
            parts = match.group(0).split("/")
            result["ocr_num1"] = parts[0] if len(parts) > 0 else None
            result["ocr_num2"] = parts[1] if len(parts) > 1 else None
            break

    # Search the full raw text (not line-by-line) so "HP\n100" is matched
    # even when the number appears on the line after the HP label.
    hp_pattern = re.compile(r"\b(\d{2,3})\s*HP\b|\bHP\s*(\d{2,3})\b", re.IGNORECASE)
    hp_match = hp_pattern.search(raw_text)
    if hp_match:
        result["hp"] = int(hp_match.group(1) or hp_match.group(2))

    illus_pattern = re.compile(r"illus\.\s*(.+)", re.IGNORECASE)
    for line in lines:
        match = illus_pattern.search(line)
        if match:
            result["illustrator"] = match.group(1).strip()
            break

    return result
