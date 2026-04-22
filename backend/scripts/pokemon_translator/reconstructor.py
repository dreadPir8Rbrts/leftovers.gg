"""
Assembles the final English card name from a translate_card() result.

Handles whitespace normalization and strips None results.
"""

from typing import Optional


def reconstruct_english_name(translated: dict) -> Optional[str]:
    """
    Extract and normalize the English name from a translate_card() result.
    Returns None if translation was unresolved.
    """
    result = translated.get("result")
    if not result:
        return None
    # Collapse multiple spaces, strip edges
    return " ".join(result.split())
