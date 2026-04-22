"""
Claude Vision service — card identification via Anthropic API.

Extracted from app.api.scans so the benchmark script and any future
callers can use it without importing the full scans router.
"""

import base64
import json
import logging
from typing import Optional

import anthropic

from app.db.session import settings

logger = logging.getLogger(__name__)

# Instructs the model to read printed text first, not guess from artwork.
IDENTIFY_PROMPT = """Identify this Pokémon card by reading the text printed on it — do not guess from artwork alone.

Step 1: Read the card name printed in large text (e.g. "Sealeo", "Pikachu", "Charizard VSTAR").
Step 2: Read the card number printed at the bottom (e.g. "044/191", "4/102").
Step 3: Read the set symbol or set name to determine the TCGdex set ID (e.g. swsh12, sv5, base1, sv8).

Reply with JSON only, no other text:
{"card_name":"","set_code":"","local_id":"","confidence":0.0}
card_name is the exact name read from the card. set_code is the TCGdex set ID. local_id is the number before the slash (e.g. "044" from "044/191"). confidence is 0.0-1.0. If you cannot read the card clearly, return confidence 0.0."""


async def call_claude(image_bytes: bytes, media_type: str = "image/jpeg") -> dict:
    """
    Call Claude Vision and return the parsed JSON identification dict.

    Args:
        image_bytes: Raw image bytes to identify.
        media_type:  MIME type of the image — use "image/webp" for TCGdex CDN
                     images, "image/jpeg" for phone captures (default).

    Returns:
        Dict with keys: card_name, set_code, local_id, confidence.

    Raises:
        json.JSONDecodeError: if the model response cannot be parsed.
        anthropic.APIError: on upstream API failure.
    """
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    image_b64 = base64.standard_b64encode(image_bytes).decode("utf-8")
    message = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=150,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
                {"type": "text", "text": IDENTIFY_PROMPT},
            ],
        }],
    )
    raw = message.content[0].text.strip()
    logger.info("call_claude — raw response: %r", raw)
    # Strip markdown code fences if the model wrapped the JSON
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    if not raw:
        logger.warning("call_claude — empty response from model, returning zero confidence")
        return {"card_name": "", "set_code": "", "local_id": "", "confidence": 0.0}
    return json.loads(raw)


def lookup_card_from_claude_result(
    result: dict,
    db,  # sqlalchemy Session
) -> Optional[tuple]:
    """
    Translate a Claude JSON result dict into a (Card, Set, Serie) DB row.

    Lookup order:
      1. card_name + local_id  (most reliable — reads printed text)
      2. set_code  + local_id  (fallback when name lookup misses)

    Returns the first matching (Card, Set, Serie) tuple, or None.
    """
    from sqlalchemy import func
    from app.models.catalog import Card, Set, Serie

    card_name: str = (result.get("card_name") or "").strip()
    set_code: str = (result.get("set_code") or "").strip()
    local_id: str = (result.get("local_id") or "").strip()

    if not local_id:
        return None

    local_id_variants = list({local_id, local_id.lstrip("0") or "0"})

    # Primary: name + local_id
    if card_name:
        row = (
            db.query(Card, Set, Serie)
            .join(Set, Card.set_id == Set.id)
            .join(Serie, Set.serie_id == Serie.id)
            .filter(
                func.lower(Card.name) == card_name.lower(),
                Card.local_id.in_(local_id_variants),
            )
            .first()
        )
        if row:
            return row

    # Fallback: set_code + local_id
    if set_code:
        row = (
            db.query(Card, Set, Serie)
            .join(Set, Card.set_id == Set.id)
            .join(Serie, Set.serie_id == Serie.id)
            .filter(
                Card.set_id == set_code,
                Card.local_id.in_(local_id_variants),
            )
            .first()
        )
        if row:
            return row

    return None
