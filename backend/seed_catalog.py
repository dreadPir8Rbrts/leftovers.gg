"""
seed_catalog.py — one-time full Pokémon catalog ingestion from TCGdex.

Usage:
    cd backend
    python seed_catalog.py                     # seed everything (~18k cards, 30-60 min)
    python seed_catalog.py --serie-id swsh     # seed one serie only
    python seed_catalog.py --set-id swsh3      # seed one set only

Re-runnable: series/sets/cards use session.merge() (upsert by PK).
             price_snapshots use INSERT ... ON CONFLICT DO UPDATE.

Rate limiting: 100ms sleep between card fetches — good citizen behavior.
"""

import argparse
import dataclasses
import time
import urllib.error
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session
from tcgdexsdk import TCGdex

from app.db.session import SessionLocal
from app.models.catalog import Card as CardModel
from app.models.catalog import PriceSnapshot
from app.models.catalog import Serie as SerieModel
from app.models.catalog import Set as SetModel

SLEEP_BETWEEN_CARDS = 0.1  # 100ms
COMMIT_BATCH_SIZE = 50      # commit every N cards within a set


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def parse_date(value: Any) -> Optional[date]:
    if not value:
        return None
    if isinstance(value, date):
        return value
    for fmt in ("%Y/%m/%d", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(value), fmt).date()
        except ValueError:
            continue
    return None


def parse_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


def as_dict(obj: Any) -> dict:
    """Coerce an SDK object or dict to a plain dict."""
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    if dataclasses.is_dataclass(obj):
        return dataclasses.asdict(obj)
    if hasattr(obj, "__dict__"):
        return {k: v for k, v in vars(obj).items() if not k.startswith("_")}
    return {}


def serialize_list(items: Any) -> Optional[list]:
    """Convert a list of SDK objects to plain dicts for JSONB storage."""
    if not items:
        return None
    result = []
    for item in items:
        if dataclasses.is_dataclass(item):
            result.append(dataclasses.asdict(item))
        elif isinstance(item, dict):
            result.append(item)
        elif hasattr(item, "__dict__"):
            result.append({k: v for k, v in vars(item).items() if not k.startswith("_")})
        else:
            result.append(str(item))
    return result or None


def build_variants(sdk_variants: Any) -> dict:
    """Map TCGdex variants object → our boolean dict."""
    if sdk_variants is None:
        return {}
    d = as_dict(sdk_variants)
    return {
        "normal": bool(d.get("normal", False)),
        "holo": bool(d.get("holo", False)),
        "reverse": bool(d.get("reverse", False)),
        "firstEdition": bool(d.get("firstEdition", False)),
    }


# ---------------------------------------------------------------------------
# Upsert: catalog tables (series / sets / cards)
# ---------------------------------------------------------------------------

def upsert_serie(db: Session, sdk_serie: Any) -> None:
    obj = SerieModel(
        id=sdk_serie.id,
        name=sdk_serie.name,
        logo_url=getattr(sdk_serie, "logo", None),
        tcg="pokemon",
        last_synced_at=now_utc(),
    )
    db.merge(obj)


def upsert_set(db: Session, sdk_set: Any, serie_id: str) -> None:
    card_count = getattr(sdk_set, "cardCount", None)
    if isinstance(card_count, int):
        official = card_count
        total = card_count
    else:
        cc = as_dict(card_count)
        official = cc.get("official")
        total = cc.get("total")

    obj = SetModel(
        id=sdk_set.id,
        serie_id=serie_id,
        name=sdk_set.name,
        release_date=parse_date(getattr(sdk_set, "releaseDate", None)),
        card_count_official=official,
        card_count_total=total,
        logo_url=getattr(sdk_set, "logo", None),
        symbol_url=getattr(sdk_set, "symbol", None),
        last_synced_at=now_utc(),
    )
    db.merge(obj)


def upsert_card(db: Session, card: Any) -> None:
    legal = getattr(card, "legal", None)
    legal_d = as_dict(legal)

    level_raw = getattr(card, "level", None)
    level_str = str(level_raw) if level_raw is not None else None

    obj = CardModel(
        id=card.id,
        set_id=card.set.id,
        local_id=str(getattr(card, "localId", "")),
        name=card.name,
        category=card.category,
        rarity=getattr(card, "rarity", None),
        illustrator=getattr(card, "illustrator", None),
        image_url=getattr(card, "image", None),
        # Pokemon-specific
        hp=getattr(card, "hp", None),
        types=getattr(card, "types", None),
        dex_ids=getattr(card, "dexId", None),
        stage=getattr(card, "stage", None),
        evolve_from=getattr(card, "evolveFrom", None),
        description=getattr(card, "description", None),
        attacks=serialize_list(getattr(card, "attacks", None)),
        abilities=serialize_list(getattr(card, "abilities", None)),
        weaknesses=serialize_list(getattr(card, "weaknesses", None)),
        resistances=serialize_list(getattr(card, "resistances", None)),
        retreat=getattr(card, "retreat", None),
        suffix=getattr(card, "suffix", None),
        level=level_str,
        regulation_mark=getattr(card, "regulationMark", None),
        # Trainer-specific
        effect=getattr(card, "effect", None),
        trainer_type=getattr(card, "trainerType", None),
        # Energy-specific
        energy_type=getattr(card, "energyType", None),
        # Shared
        variants=build_variants(getattr(card, "variants", None)),
        legal_standard=legal_d.get("standard"),
        legal_expanded=legal_d.get("expanded"),
        tcgdex_updated_at=parse_datetime(getattr(card, "updated", None)),
        last_synced_at=now_utc(),
    )
    db.merge(obj)


# ---------------------------------------------------------------------------
# Upsert: price_snapshots
# TCGdex pricing structure on a full card object:
#   card.pricing = {
#     "tcgplayer": {
#       "normal":         { lowPrice, midPrice, highPrice, marketPrice, directLowPrice },
#       "holofoil":       { ... },
#       "reverseHolofoil":{ ... },
#       "1stEdition":     { ... },
#       ...
#     },
#     "cardmarket": {
#       "avg1", "avg7", "avg30", "averageSellPrice", "lowPrice", "trendPrice",
#       "avg1-holo", "avg7-holo", "avg30-holo", ...   (flat, holo fields suffixed)
#     }
#   }
# ---------------------------------------------------------------------------

# TCGPlayer variant key → our schema variant string
TCGPLAYER_VARIANT_MAP = {
    "normal":              "normal",
    "holofoil":            "holofoil",
    "reverseHolofoil":     "reverse-holofoil",
    "reverse":             "reverse-holofoil",   # alternative key name
    "1stEdition":          "1st-edition",
    "1stEditionHolofoil":  "1st-edition-holofoil",
    "unlimited":           "unlimited",
    "unlimitedHolofoil":   "unlimited-holofoil",
}


def upsert_price_snapshots(db: Session, card: Any) -> None:
    pricing_raw = getattr(card, "pricing", None)
    if not pricing_raw:
        return

    pricing = as_dict(pricing_raw)
    fetched = now_utc()
    expires = fetched + timedelta(hours=24)

    # --- TCGPlayer ---
    tcgp = as_dict(pricing.get("tcgplayer"))
    for sdk_key, schema_variant in TCGPLAYER_VARIANT_MAP.items():
        variant_raw = tcgp.get(sdk_key)
        if not variant_raw:
            continue
        v = as_dict(variant_raw)
        _upsert_snapshot(
            db,
            card_id=card.id,
            source="tcgplayer",
            variant=schema_variant,
            currency="USD",
            low_price=v.get("lowPrice") or v.get("low"),
            mid_price=v.get("midPrice") or v.get("mid"),
            high_price=v.get("highPrice") or v.get("high"),
            market_price=v.get("marketPrice") or v.get("market"),
            direct_low_price=v.get("directLowPrice") or v.get("directLow"),
            fetched_at=fetched,
            expires_at=expires,
        )

    # --- Cardmarket (flat structure; holo fields use "-holo" or "Holo" suffix) ---
    cm_raw = as_dict(pricing.get("cardmarket"))
    # Cardmarket may have a nested "prices" key or be flat
    cm = as_dict(cm_raw.get("prices")) if cm_raw.get("prices") else cm_raw

    _BASE_CM_FIELDS = ("avg1", "avg7", "avg30", "averageSellPrice", "lowPrice", "trendPrice",
                       "avg", "low", "trend")
    if any(cm.get(f) is not None for f in _BASE_CM_FIELDS):
        _upsert_snapshot(
            db,
            card_id=card.id,
            source="cardmarket",
            variant="normal",
            currency="EUR",
            low_price=cm.get("lowPrice") or cm.get("low"),
            avg=cm.get("averageSellPrice") or cm.get("avg"),
            trend=cm.get("trendPrice") or cm.get("trend"),
            avg_1=cm.get("avg1"),
            avg_7=cm.get("avg7"),
            avg_30=cm.get("avg30"),
            fetched_at=fetched,
            expires_at=expires,
        )

    # Holo variant: flat fields with "-holo" or "Holo" suffix
    holo_avg = cm.get("avg-holo") or cm.get("avgHolo") or cm.get("averageSellPriceHolo")
    if holo_avg is not None:
        _upsert_snapshot(
            db,
            card_id=card.id,
            source="cardmarket",
            variant="holo",
            currency="EUR",
            low_price=cm.get("low-holo") or cm.get("lowHolo"),
            avg=holo_avg,
            trend=cm.get("trend-holo") or cm.get("trendHolo"),
            avg_1=cm.get("avg1-holo") or cm.get("avg1Holo"),
            avg_7=cm.get("avg7-holo") or cm.get("avg7Holo"),
            avg_30=cm.get("avg30-holo") or cm.get("avg30Holo"),
            fetched_at=fetched,
            expires_at=expires,
        )


def _upsert_snapshot(
    db: Session,
    card_id: str,
    source: str,
    variant: str,
    currency: str,
    fetched_at: datetime,
    expires_at: datetime,
    low_price=None,
    mid_price=None,
    high_price=None,
    market_price=None,
    direct_low_price=None,
    avg=None,
    trend=None,
    avg_1=None,
    avg_7=None,
    avg_30=None,
) -> None:
    stmt = (
        pg_insert(PriceSnapshot)
        .values(
            id=uuid.uuid4(),
            card_id=card_id,
            source=source,
            variant=variant,
            currency=currency,
            low_price=low_price,
            mid_price=mid_price,
            high_price=high_price,
            market_price=market_price,
            direct_low_price=direct_low_price,
            avg=avg,
            trend=trend,
            avg_1=avg_1,
            avg_7=avg_7,
            avg_30=avg_30,
            fetched_at=fetched_at,
            expires_at=expires_at,
        )
        .on_conflict_do_update(
            constraint="uq_price_snapshots_card_source_variant",
            set_={
                "currency": currency,
                "low_price": low_price,
                "mid_price": mid_price,
                "high_price": high_price,
                "market_price": market_price,
                "direct_low_price": direct_low_price,
                "avg": avg,
                "trend": trend,
                "avg_1": avg_1,
                "avg_7": avg_7,
                "avg_30": avg_30,
                "fetched_at": fetched_at,
                "expires_at": expires_at,
            },
        )
    )
    db.execute(stmt)


# ---------------------------------------------------------------------------
# Seed orchestration
# ---------------------------------------------------------------------------

def seed_set(
    db: Session,
    sdk: TCGdex,
    set_id: str,
    serie_id: str,
    set_index: int,
    total_sets: int,
) -> None:
    try:
        full_set = sdk.set.getSync(set_id)
    except urllib.error.HTTPError as e:
        print(f"  WARNING: HTTP {e.code} fetching set {set_id} — skipping")
        return
    except Exception as e:
        print(f"  WARNING: error fetching set {set_id} ({e}) — skipping")
        return

    if full_set is None:
        print(f"  WARNING: could not fetch set {set_id} — skipping")
        return

    upsert_set(db, full_set, serie_id)
    db.commit()

    cards = getattr(full_set, "cards", None) or []
    print(f"  [{set_index}/{total_sets}] {full_set.name} ({set_id}) — {len(cards)} cards")

    for i, card_brief in enumerate(cards, 1):
        try:
            card = sdk.card.getSync(card_brief.id)
        except urllib.error.HTTPError as e:
            print(f"    WARNING: HTTP {e.code} fetching card {card_brief.id} — skipping")
            continue
        except Exception as e:
            print(f"    WARNING: error fetching card {card_brief.id} ({e}) — skipping")
            continue

        if card is None:
            print(f"    WARNING: could not fetch card {card_brief.id} — skipping")
            continue

        upsert_card(db, card)
        upsert_price_snapshots(db, card)

        if i % COMMIT_BATCH_SIZE == 0:
            db.commit()
            print(f"    ... {i}/{len(cards)}")

        time.sleep(SLEEP_BETWEEN_CARDS)

    db.commit()
    print(f"    Done — {len(cards)} cards seeded")


def seed_serie(db: Session, sdk: TCGdex, serie_id: str) -> None:
    full_serie = sdk.serie.getSync(serie_id)
    if full_serie is None:
        print(f"WARNING: could not fetch serie {serie_id} — skipping")
        return

    upsert_serie(db, full_serie)
    db.commit()

    sets = getattr(full_serie, "sets", None) or []
    print(f"\nSerie: {full_serie.name} ({serie_id}) — {len(sets)} sets")

    for i, s in enumerate(sets, 1):
        seed_set(db, sdk, s.id, serie_id, i, len(sets))


def seed_all(db: Session, sdk: TCGdex) -> None:
    series_list = sdk.serie.listSync()
    print(f"Found {len(series_list)} series\n")

    for serie_brief in series_list:
        seed_serie(db, sdk, serie_brief.id)

    print("\nSeed complete.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the CardOps catalog from TCGdex")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--serie-id", metavar="ID", help="Seed a single serie (e.g. swsh)")
    group.add_argument("--set-id", metavar="ID", help="Seed a single set (e.g. swsh3)")
    args = parser.parse_args()

    sdk = TCGdex("en")
    db: Session = SessionLocal()

    try:
        if args.set_id:
            # Resolve the parent serie so we can upsert it first
            full_set = sdk.set.getSync(args.set_id)
            if full_set is None:
                print(f"ERROR: set '{args.set_id}' not found")
                return
            serie_ref = getattr(full_set, "serie", None)
            serie_id = serie_ref.id if serie_ref else "unknown"
            if serie_id != "unknown":
                full_serie = sdk.serie.getSync(serie_id)
                if full_serie:
                    upsert_serie(db, full_serie)
                    db.commit()
            seed_set(db, sdk, args.set_id, serie_id, 1, 1)

        elif args.serie_id:
            seed_serie(db, sdk, args.serie_id)

        else:
            seed_all(db, sdk)

    finally:
        db.close()


if __name__ == "__main__":
    main()
