"""catalog tables: series, sets, cards, price_snapshots

Revision ID: 0001
Revises:
Create Date: 2026-03-18

Notes:
- catalog_overrides table is planned for a future migration.
  It will store local corrections to TCGdex-sourced fields without
  mutating the synced rows directly, keeping re-syncs safe.
- pg_trgm extension required for the GIN trigram index on cards.name.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PRICE_VARIANT_VALUES = (
    "'normal', 'holofoil', 'reverse-holofoil', "
    "'1st-edition', '1st-edition-holofoil', "
    "'unlimited', 'unlimited-holofoil', 'holo'"
)


def upgrade() -> None:
    # pg_trgm is needed for the GIN trigram index on cards.name
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # ------------------------------------------------------------------
    # series
    # ------------------------------------------------------------------
    op.create_table(
        "series",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("logo_url", sa.String(), nullable=True),
        sa.Column("tcg", sa.String(), nullable=False),
        sa.Column("last_synced_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("tcg IN ('pokemon', 'one_piece')", name="series_tcg_check"),
    )

    # ------------------------------------------------------------------
    # sets
    # ------------------------------------------------------------------
    op.create_table(
        "sets",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("serie_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("release_date", sa.Date(), nullable=True),
        sa.Column("card_count_official", sa.Integer(), nullable=True),
        sa.Column("card_count_total", sa.Integer(), nullable=True),
        sa.Column("logo_url", sa.String(), nullable=True),
        sa.Column("symbol_url", sa.String(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["serie_id"], ["series.id"], name="fk_sets_serie_id"),
    )

    # ------------------------------------------------------------------
    # cards
    # ------------------------------------------------------------------
    op.create_table(
        "cards",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("set_id", sa.String(), nullable=False),
        sa.Column("local_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("rarity", sa.String(), nullable=True),
        sa.Column("illustrator", sa.String(), nullable=True),
        sa.Column("image_url", sa.String(), nullable=True),
        # Pokemon-specific
        sa.Column("hp", sa.Integer(), nullable=True),
        sa.Column("types", JSONB(), nullable=True),
        sa.Column("dex_ids", JSONB(), nullable=True),
        sa.Column("stage", sa.String(), nullable=True),
        sa.Column("evolve_from", sa.String(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("attacks", JSONB(), nullable=True),
        sa.Column("abilities", JSONB(), nullable=True),
        sa.Column("weaknesses", JSONB(), nullable=True),
        sa.Column("resistances", JSONB(), nullable=True),
        sa.Column("retreat", sa.Integer(), nullable=True),
        sa.Column("suffix", sa.String(), nullable=True),
        sa.Column("level", sa.String(), nullable=True),
        sa.Column("regulation_mark", sa.String(), nullable=True),
        # Trainer-specific
        sa.Column("effect", sa.Text(), nullable=True),
        sa.Column("trainer_type", sa.String(), nullable=True),
        # Energy-specific
        sa.Column("energy_type", sa.String(), nullable=True),
        # Shared
        sa.Column("variants", JSONB(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("legal_standard", sa.Boolean(), nullable=True),
        sa.Column("legal_expanded", sa.Boolean(), nullable=True),
        sa.Column("tcgdex_updated_at", sa.DateTime(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["set_id"], ["sets.id"], name="fk_cards_set_id"),
        sa.CheckConstraint(
            "category IN ('Pokemon', 'Trainer', 'Energy')",
            name="cards_category_check",
        ),
    )

    # GIN trigram index: supports ILIKE / similarity search on card name
    op.create_index(
        "ix_cards_name_gin",
        "cards",
        ["name"],
        postgresql_using="gin",
        postgresql_ops={"name": "gin_trgm_ops"},
    )

    # ------------------------------------------------------------------
    # price_snapshots
    # ------------------------------------------------------------------
    op.create_table(
        "price_snapshots",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("card_id", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("variant", sa.String(), nullable=False),
        sa.Column("currency", sa.String(), nullable=False),
        # TCGPlayer fields
        sa.Column("low_price", sa.Numeric(10, 2), nullable=True),
        sa.Column("mid_price", sa.Numeric(10, 2), nullable=True),
        sa.Column("high_price", sa.Numeric(10, 2), nullable=True),
        sa.Column("market_price", sa.Numeric(10, 2), nullable=True),
        sa.Column("direct_low_price", sa.Numeric(10, 2), nullable=True),
        # Cardmarket fields
        sa.Column("avg", sa.Numeric(10, 2), nullable=True),
        sa.Column("trend", sa.Numeric(10, 2), nullable=True),
        sa.Column("avg_1", sa.Numeric(10, 2), nullable=True),
        sa.Column("avg_7", sa.Numeric(10, 2), nullable=True),
        sa.Column("avg_30", sa.Numeric(10, 2), nullable=True),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["card_id"], ["cards.id"], name="fk_price_snapshots_card_id"),
        sa.UniqueConstraint(
            "card_id", "source", "variant",
            name="uq_price_snapshots_card_source_variant",
        ),
        sa.CheckConstraint(
            "source IN ('tcgplayer', 'cardmarket')",
            name="price_snapshots_source_check",
        ),
        sa.CheckConstraint(
            f"variant IN ({PRICE_VARIANT_VALUES})",
            name="price_snapshots_variant_check",
        ),
    )

    op.create_index("ix_price_snapshots_card_id", "price_snapshots", ["card_id"])
    op.create_index("ix_price_snapshots_expires_at", "price_snapshots", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_price_snapshots_expires_at", table_name="price_snapshots")
    op.drop_index("ix_price_snapshots_card_id", table_name="price_snapshots")
    op.drop_table("price_snapshots")
    op.drop_index("ix_cards_name_gin", table_name="cards")
    op.drop_table("cards")
    op.drop_table("sets")
    op.drop_table("series")
