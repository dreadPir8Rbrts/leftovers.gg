"""
Catalog models — sourced from TCGdex, treated as immutable except via sync jobs.

catalog_overrides table is planned for future use to store local corrections
without touching synced fields. Not implemented in Phase 0.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.db.session import Base


class Serie(Base):
    __tablename__ = "series"

    id = Column(String, primary_key=True)  # TCGdex serie id e.g. 'swsh'
    name = Column(String, nullable=False)
    logo_url = Column(String, nullable=True)
    tcg = Column(
        String,
        nullable=False,
        default="pokemon",
    )
    last_synced_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint("tcg IN ('pokemon', 'one_piece')", name="series_tcg_check"),
    )


class Set(Base):
    __tablename__ = "sets"

    id = Column(String, primary_key=True)  # TCGdex set id e.g. 'swsh3'
    serie_id = Column(String, ForeignKey("series.id"), nullable=False)
    name = Column(String, nullable=False)
    release_date = Column(Date, nullable=True)
    card_count_official = Column(Integer, nullable=True)
    card_count_total = Column(Integer, nullable=True)
    logo_url = Column(String, nullable=True)
    symbol_url = Column(String, nullable=True)
    last_synced_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class Card(Base):
    __tablename__ = "cards"

    id = Column(String, primary_key=True)  # TCGdex id e.g. 'swsh3-136'
    set_id = Column(String, ForeignKey("sets.id"), nullable=False)
    local_id = Column(String, nullable=False)  # card number within set
    name = Column(String, nullable=False)
    category = Column(String, nullable=False)
    rarity = Column(String, nullable=True)
    illustrator = Column(String, nullable=True)
    image_url = Column(String, nullable=True)  # TCGdex CDN URL — not re-hosted

    # Pokemon-specific
    hp = Column(Integer, nullable=True)
    types = Column(JSONB, nullable=True)           # ['Fire', 'Water']
    dex_ids = Column(JSONB, nullable=True)          # [4, 5, 6]
    stage = Column(String, nullable=True)           # Basic, Stage1, Stage2
    evolve_from = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    attacks = Column(JSONB, nullable=True)
    abilities = Column(JSONB, nullable=True)
    weaknesses = Column(JSONB, nullable=True)
    resistances = Column(JSONB, nullable=True)
    retreat = Column(Integer, nullable=True)
    suffix = Column(String, nullable=True)
    level = Column(String, nullable=True)
    regulation_mark = Column(String, nullable=True)

    # Trainer-specific
    effect = Column(Text, nullable=True)
    trainer_type = Column(String, nullable=True)

    # Energy-specific
    energy_type = Column(String, nullable=True)

    # Shared
    # {"normal": true, "holo": false, "reverse": true, "firstEdition": false}
    variants = Column(JSONB, nullable=False, default=dict)
    legal_standard = Column(Boolean, nullable=True)
    legal_expanded = Column(Boolean, nullable=True)
    tcgdex_updated_at = Column(DateTime, nullable=True)
    last_synced_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        CheckConstraint(
            "category IN ('Pokemon', 'Trainer', 'Energy')",
            name="cards_category_check",
        ),
        # GIN index for fast full-text search on card name
        Index("ix_cards_name_gin", "name", postgresql_using="gin",
              postgresql_ops={"name": "gin_trgm_ops"}),
    )


# Known price variants from TCGdex / TCGPlayer / Cardmarket.
# VARCHAR + check constraint (not a PG ENUM) to stay extensible for One Piece.
PRICE_VARIANT_CHECK = (
    "variant IN ("
    "'normal', 'holofoil', 'reverse-holofoil', "
    "'1st-edition', '1st-edition-holofoil', "
    "'unlimited', 'unlimited-holofoil', 'holo'"
    ")"
)


class SoldComp(Base):
    """Individual sold listing record scraped from eBay by the droplet scraper."""

    __tablename__ = "sold_comps"
    __table_args__ = (
        UniqueConstraint("listing_url", name="uq_sold_comps_listing_url"),
        {"schema": "public"},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    card_v2_id = Column(UUID(as_uuid=True), ForeignKey("public.cards_v2.id", ondelete="CASCADE"), nullable=False)
    source = Column(String(20), nullable=False)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    listing_url = Column(String(1000), nullable=False)
    price = Column(Numeric(10, 2), nullable=False)
    currency = Column(String(3), nullable=False, default="USD")
    sold_date = Column(DateTime, nullable=True)
    condition_type = Column(String(10), nullable=True)
    condition_ungraded = Column(String(5), nullable=True)
    grading_company = Column(String(10), nullable=True)
    grade = Column(String(30), nullable=True)
    grading_company_other = Column(String(100), nullable=True)
    sale_type = Column(String(20), nullable=True)
    fetched_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class PriceSnapshot(Base):
    __tablename__ = "price_snapshots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    card_id = Column(String, ForeignKey("cards.id"), nullable=True)   # legacy — superseded by card_v2_id
    card_v2_id = Column(UUID(as_uuid=True), ForeignKey("public.cards_v2.id", ondelete="CASCADE"), nullable=True)
    source = Column(String, nullable=False)      # 'tcgplayer' | 'cardmarket'
    variant = Column(String, nullable=False)      # see PRICE_VARIANT_CHECK
    currency = Column(String, nullable=False)     # 'USD' | 'EUR'

    # TCGPlayer fields
    low_price = Column(Numeric(10, 2), nullable=True)
    mid_price = Column(Numeric(10, 2), nullable=True)
    high_price = Column(Numeric(10, 2), nullable=True)
    market_price = Column(Numeric(10, 2), nullable=True)
    direct_low_price = Column(Numeric(10, 2), nullable=True)  # TCGPlayer-only; null on Cardmarket rows

    # Cardmarket fields
    avg = Column(Numeric(10, 2), nullable=True)
    trend = Column(Numeric(10, 2), nullable=True)
    avg_1 = Column(Numeric(10, 2), nullable=True)
    avg_7 = Column(Numeric(10, 2), nullable=True)
    avg_30 = Column(Numeric(10, 2), nullable=True)

    fetched_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)  # fetched_at + 24h TTL

    __table_args__ = (
        UniqueConstraint("card_v2_id", "source", "variant", name="uq_price_snapshots_card_v2_source_variant"),
        CheckConstraint(
            "source IN ('tcgplayer', 'cardmarket')",
            name="price_snapshots_source_check",
        ),
        CheckConstraint(PRICE_VARIANT_CHECK, name="price_snapshots_variant_check"),
        Index("ix_price_snapshots_card_v2_id", "card_v2_id"),
        Index("ix_price_snapshots_expires_at", "expires_at"),
    )
