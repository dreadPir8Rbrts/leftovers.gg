"""
Component-level translation logic.

Translation strategy per component:
  - Pokémon name tokens  → PokéAPI JSON lookup map (pokemon_names.json)
  - Form / prefix tokens → Static rules maps (rules.py)
  - Mechanic suffixes    → Pass through unchanged
  - Trainer / Energy     → trainer_names.json cache, then Claude API fallback
  - Any miss             → Claude API fallback (result cached back to JSON)
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .rules import FORM_MAP, PREFIX_MAP

_HERE = Path(__file__).parent
_POKEMON_MAP_PATH = _HERE / "pokemon_names.json"
_TRAINER_MAP_PATH = _HERE / "trainer_names.json"

_anthropic_client = None


def _get_client():
    global _anthropic_client
    if _anthropic_client is None:
        from anthropic import Anthropic
        from app.db.session import settings
        _anthropic_client = Anthropic(api_key=settings.anthropic_api_key)
    return _anthropic_client


def load_pokemon_map() -> Dict[str, str]:
    if _POKEMON_MAP_PATH.exists():
        return json.loads(_POKEMON_MAP_PATH.read_text(encoding="utf-8"))
    return {}


def load_trainer_map() -> Dict[str, str]:
    if _TRAINER_MAP_PATH.exists():
        return json.loads(_TRAINER_MAP_PATH.read_text(encoding="utf-8"))
    return {}


def _save_json(path: Path, data: Dict[str, str]) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _claude_fallback(
    japanese_name: str,
    supertype: Optional[str],
    set_name: Optional[str],
    no_fallback: bool,
) -> Optional[str]:
    if no_fallback:
        return None
    prompt = (
        "You are a Pokémon TCG expert. Translate the following Japanese Pokémon card name "
        "to its official English name.\n"
        "Return ONLY the English card name. No explanation, no punctuation, no extra text.\n"
        "If you cannot confidently identify it, return exactly: null\n\n"
        f"Japanese card name: {japanese_name}\n"
        f"Card supertype: {supertype or 'unknown'}\n"
        f"Set name (if known): {set_name or 'unknown'}"
    )
    msg = _get_client().messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=50,
        messages=[{"role": "user", "content": prompt}],
    )
    result = msg.content[0].text.strip()
    return None if result.lower() == "null" else result


def _lookup_pokemon(
    token: str,
    pokemon_map: Dict[str, str],
    supertype: Optional[str],
    set_name: Optional[str],
    no_fallback: bool,
) -> Tuple[Optional[str], str]:
    """Returns (english_name_or_None, resolved_by)."""
    if token in pokemon_map:
        return pokemon_map[token], "map"
    result = _claude_fallback(token, supertype or "Pokémon", set_name, no_fallback)
    if result:
        pokemon_map[token] = result
        _save_json(_POKEMON_MAP_PATH, pokemon_map)
        return result, "claude"
    return None, "unresolved"


def translate_card(
    parsed: Dict[str, Any],
    pokemon_map: Dict[str, str],
    trainer_map: Dict[str, str],
    set_name: Optional[str] = None,
    no_fallback: bool = False,
) -> Dict[str, Any]:
    """
    Translate a parsed card dict into an English name.

    Returns {"result": str_or_None, "resolved_by": str} where resolved_by is one of:
    "passthrough", "map", "claude", "trainer_map", "unresolved".
    """
    if parsed["already_english"]:
        return {"result": parsed["raw"], "resolved_by": "passthrough"}

    raw = parsed["raw"]
    supertype = parsed.get("supertype")

    # --- Trainer / Energy ---
    if parsed["is_trainer"]:
        if raw in trainer_map:
            return {"result": trainer_map[raw], "resolved_by": "trainer_map"}
        result = _claude_fallback(raw, supertype, set_name, no_fallback)
        if result:
            trainer_map[raw] = result
            _save_json(_TRAINER_MAP_PATH, trainer_map)
            return {"result": result, "resolved_by": "claude"}
        return {"result": None, "resolved_by": "unresolved"}

    # --- TAG TEAM ---
    if parsed["is_tag_team"]:
        parts_en: List[str] = []
        resolved_by = "map"
        for token in (parsed["tag_team_tokens"] or []):
            en, by = _lookup_pokemon(token, pokemon_map, supertype, set_name, no_fallback)
            if by in ("claude", "unresolved"):
                resolved_by = by
            parts_en.append(en or token)
        assembled = " & ".join(parts_en)
        if parsed["mechanic_suffix"]:
            assembled += f" {parsed['mechanic_suffix']}"
        return {"result": assembled.strip(), "resolved_by": resolved_by}

    # --- Regular Pokémon card ---

    # Try the full token (minus suffix) in the map first. This correctly handles
    # Pokémon whose names look like mechanic prefixes, e.g. メガヤンマ = Yanmega.
    pokemon_token = parsed["pokemon_token"]
    if pokemon_token:
        full_token = pokemon_token
        if parsed["prefix"]:
            full_token = parsed["prefix"] + pokemon_token
        if parsed["variant_token"]:
            full_token = full_token + parsed["variant_token"]

        if full_token in pokemon_map:
            result = pokemon_map[full_token]
            if parsed["mechanic_suffix"]:
                result += f" {parsed['mechanic_suffix']}"
            return {"result": result, "resolved_by": "map"}

    # Assemble from decomposed components
    components: List[str] = []
    resolved_by = "map"

    if parsed["prefix"]:
        components.append(PREFIX_MAP.get(parsed["prefix"], parsed["prefix"]))

    if parsed["form_token"]:
        form_en = FORM_MAP.get(parsed["form_token"], "")
        if form_en:
            components.append(form_en)

    if pokemon_token:
        en_pokemon, by = _lookup_pokemon(pokemon_token, pokemon_map, supertype, set_name, no_fallback)
        if by in ("claude", "unresolved"):
            resolved_by = by
        components.append(en_pokemon or pokemon_token)

    if parsed["variant_token"]:
        components.append(parsed["variant_token"])

    if parsed["mechanic_suffix"]:
        components.append(parsed["mechanic_suffix"])

    result = " ".join(c for c in components if c).strip()
    return {"result": result or None, "resolved_by": resolved_by}
