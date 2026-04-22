"""Static lookup maps for Pokémon TCG card name components."""

# Regional form tokens — JA catalog uses space-separated tokens (e.g. "ヒスイ バスラオ")
# but some older sets concatenate with の (e.g. "ヒスイのゾロアーク"). Both are handled.
FORM_MAP = {
    "アローラ": "Alolan",
    "アローラの": "Alolan",
    "ガラル": "Galarian",
    "ガラルの": "Galarian",
    "ヒスイ": "Hisuian",
    "ヒスイの": "Hisuian",
    "パルデア": "Paldean",
    "パルデアの": "Paldean",
    "のすがた": "",
}

# Mechanic prefixes that appear before the base Pokémon name.
# NOTE: メガ is also a component of some Pokémon names (e.g. メガヤンマ = Yanmega).
# translator.py tries the full token in the PokéAPI map before stripping these prefixes.
PREFIX_MAP = {
    "メガ": "Mega",
    "ダーク": "Dark",
    "ライト": "Light",
    "プリズム": "Prism",
    "アーマード": "Armored",
}

# Mechanic suffixes — passed through unchanged. Ordered longest-first to prevent
# partial matches (e.g. "VMAX" must be checked before "V").
MECHANIC_SUFFIXES = ["V-UNION", "VSTAR", "VMAX", "GX", "EX", "ex", "V", "LEGEND"]

# Supertypes that have no Pokémon name component. Stored in Japanese in the JA catalog.
TRAINER_SUPERTYPES = {"トレーナー", "エネルギー", "Trainer", "Energy"}
