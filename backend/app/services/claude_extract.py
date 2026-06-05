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

_EXTRACTION_PROMPT = """You are analyzing a Pokémon trading card image. Extract every identifiable field and return ONLY a valid JSON object — no preamble, no markdown fences.

IMPORTANT — atypical cards: Most cards have a name printed in a name box at the top. However, some vintage Trainer or special cards (e.g. old Japanese vending series) have NO name box. For those cards, look for the most prominent identifying text written within the artwork itself — such as text on a machine, sign, building, or label in the illustration — and use that as the name. Do NOT use "POCKET MONSTERS CARD GAME" as the name; that text appears on the bottom border of all cards and is a set/copyright marker, not the card name.

Return this exact structure (use null for fields you cannot read):
{
  "name": "card name as printed in any language — for no-name-box cards, use the most prominent identifying text in the artwork",
  "en_name": "English name — infer or translate if card is in another language, copy name if already English",
  "number": "card number exactly as printed (e.g. 029/131, No.150, 1/102, TG15/TG30) — null if absent",
  "hp": 80,
  "artist": "illustrator name if printed",
  "attacks": ["attack name 1", "attack name 2"],
  "flavor_text": "first 10 words of italic flavor text if present",
  "rarity_symbol": "symbol near card number (e.g. ★, ●, ◆, ◇, ☆)",
  "language": "English or Japanese or other",
  "visible_text": ["every", "distinct", "text", "string", "visible", "on", "the", "card"]
}

For visible_text: list every distinct readable text string on the card, largest/most prominent first. Include text in the artwork, name box, attack names, borders, and set info. Exclude single characters and © symbols."""


async def extract_card_fields(image_bytes: bytes, media_type: str = "image/jpeg") -> Dict[str, Any]:
    """
    Send card image to Claude and return structured extraction dict.
    Returns empty dict on parse failure — caller handles gracefully.
    """
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    b64 = base64.standard_b64encode(image_bytes).decode("utf-8")

    message = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=600,
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
