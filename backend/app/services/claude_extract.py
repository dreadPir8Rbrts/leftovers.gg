"""
Claude-based structured card field extraction for Quick Scan v2.

Replaces Google Cloud Vision OCR with a semantics-aware extraction that
handles any language, layout, age, or condition. Returns a richer dict
than raw OCR: includes en_name, artist, attacks, flavor_text, rarity_symbol.

Used by POST /scans/quick-identify-v2.
"""

import base64
import json
import logging
from typing import Any, Dict

import anthropic

from app.db.session import settings

logger = logging.getLogger(__name__)

_EXTRACTION_PROMPT = """You are analyzing a trading card image. Extract every identifiable field and return ONLY a valid JSON object — no preamble, no markdown fences.

Return this exact structure (use null for fields you cannot read):
{
  "name": "card name exactly as printed (any language)",
  "en_name": "English name — infer if card is in another language, copy name if already English",
  "number": "card number exactly as printed (e.g. 029/131, No.150, 1/102, TG15/TG30)",
  "hp": 80,
  "artist": "illustrator name if printed",
  "attacks": ["attack name 1", "attack name 2"],
  "flavor_text": "first 10 words of italic flavor text if present",
  "rarity_symbol": "symbol near card number (e.g. ★, ●, ◆, ◇, ☆)",
  "language": "English or Japanese or other"
}"""


async def extract_card_fields(image_bytes: bytes, media_type: str = "image/jpeg") -> Dict[str, Any]:
    """
    Send card image to Claude and return structured extraction dict.
    Returns empty dict on parse failure — caller handles gracefully.
    """
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    b64 = base64.standard_b64encode(image_bytes).decode("utf-8")

    message = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=400,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                {"type": "text", "text": _EXTRACTION_PROMPT},
            ],
        }],
    )

    raw = message.content[0].text.strip()
    logger.info("claude_extract — raw response: %r", raw)

    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("claude_extract — JSON parse failed, raw: %r", raw)
        return {}
