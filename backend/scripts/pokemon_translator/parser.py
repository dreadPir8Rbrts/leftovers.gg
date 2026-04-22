"""
Card name component parser for Japanese Pokémon TCG cards.

Decomposes a Japanese card name into structured components so each piece can be
translated by the appropriate strategy (PokéAPI map, static rules, Claude fallback).
"""

import re
from typing import Any, Dict, List, Optional, Tuple

from .rules import FORM_MAP, MECHANIC_SUFFIXES, PREFIX_MAP, TRAINER_SUPERTYPES


def has_japanese(text: str) -> bool:
    return bool(re.search(r"[\u3040-\u30ff\u4e00-\u9fff]", text))


def _strip_mechanic_suffix(name: str) -> Tuple[Optional[str], str]:
    """Strip a mechanic suffix. Returns (suffix_or_None, remaining_name)."""
    for suffix in MECHANIC_SUFFIXES:
        if name.endswith(f" {suffix}"):
            return suffix, name[: -(len(suffix) + 1)].rstrip()
        if name.endswith(suffix) and len(name) > len(suffix):
            remaining = name[: -len(suffix)]
            # Only strip if remaining ends with a non-ASCII char (Japanese) or uppercase letter
            if remaining and (ord(remaining[-1]) > 0x7F or remaining[-1].isupper()):
                return suffix, remaining
    return None, name


def _strip_form_token(tokens: List[str]) -> Tuple[Optional[str], List[str]]:
    """Remove a space-separated form token. Returns (form_ja_or_None, remaining_tokens)."""
    for i, token in enumerate(tokens):
        if token in FORM_MAP:
            return token, tokens[:i] + tokens[i + 1 :]
    return None, tokens


def _strip_prefix(name: str) -> Tuple[Optional[str], str]:
    """Strip a mechanic prefix from the start. Returns (prefix_ja_or_None, remaining_name)."""
    for ja_prefix in PREFIX_MAP:
        if name.startswith(ja_prefix):
            return ja_prefix, name[len(ja_prefix) :]
    return None, name


def _strip_inline_form(name: str) -> Tuple[Optional[str], str]:
    """Strip a concatenated form token (e.g. 'ヒスイの'). Returns (form_ja_or_None, remaining)."""
    # Check longer tokens first to avoid partial matches
    for ja_form in sorted(FORM_MAP, key=len, reverse=True):
        if ja_form and ja_form in name and ja_form != name:
            return ja_form, name.replace(ja_form, "", 1).strip()
    return None, name


def _strip_variant(name: str) -> Tuple[Optional[str], str]:
    """Strip a trailing ASCII uppercase variant letter (X, Y, etc.)."""
    m = re.search(r"([A-Z])$", name)
    if m:
        return m.group(1), name[: m.start()].rstrip()
    return None, name


def parse_card_name(japanese_name: str, supertype: Optional[str]) -> Dict[str, Any]:
    """
    Decompose a Japanese TCG card name into translatable components.

    Returned dict keys:
      already_english  — True if name contains no Japanese characters
      is_trainer       — True for Trainer / Energy supertypes
      is_tag_team      — True for cards with & separator
      prefix           — JA mechanic prefix token (e.g. 'メガ'), or None
      form_token       — JA form token (e.g. 'ヒスイ'), or None
      pokemon_token    — core JA Pokémon name, or None
      tag_team_tokens  — list of JA Pokémon name tokens for TAG TEAM cards, or None
      variant_token    — ASCII variant letter (e.g. 'X'), or None
      mechanic_suffix  — pass-through suffix (e.g. 'GX'), or None
      raw              — original unmodified input
    """
    name = japanese_name.strip()

    if not has_japanese(name):
        return _base(japanese_name, already_english=True)

    if supertype in TRAINER_SUPERTYPES:
        return _base(japanese_name, is_trainer=True)

    is_tag_team = "&" in name or "\uff06" in name  # \uff06 = full-width ＆
    if is_tag_team:
        sep = "\uff06" if "\uff06" in name else "&"
        parts = [p.strip() for p in name.split(sep)]
        suffix, parts[-1] = _strip_mechanic_suffix(parts[-1].strip())
        parts = [p for p in parts if p]
        return {**_base(japanese_name, is_tag_team=True), "tag_team_tokens": parts, "mechanic_suffix": suffix}

    # 1. Strip mechanic suffix
    mechanic_suffix, name = _strip_mechanic_suffix(name)

    # 2. Tokenize on spaces; check for space-separated form token (e.g. "ヒスイ バスラオ")
    tokens = name.split()
    form_token, tokens = _strip_form_token(tokens)
    name = " ".join(tokens).strip()

    # 3. Check for concatenated inline form (e.g. "ヒスイのゾロアーク")
    if not form_token:
        form_token, name = _strip_inline_form(name)

    # 4. Strip mechanic prefix
    prefix, name = _strip_prefix(name)

    # 5. Strip ASCII variant suffix
    variant_token, name = _strip_variant(name)

    return {
        "already_english": False,
        "is_trainer": False,
        "is_tag_team": False,
        "prefix": prefix,
        "form_token": form_token,
        "pokemon_token": name.strip() or None,
        "tag_team_tokens": None,
        "variant_token": variant_token,
        "mechanic_suffix": mechanic_suffix,
        "raw": japanese_name,
    }


def _base(raw: str, **overrides: Any) -> Dict[str, Any]:
    base: Dict[str, Any] = {
        "already_english": False,
        "is_trainer": False,
        "is_tag_team": False,
        "prefix": None,
        "form_token": None,
        "pokemon_token": None,
        "tag_team_tokens": None,
        "variant_token": None,
        "mechanic_suffix": None,
        "raw": raw,
    }
    base.update(overrides)
    return base
