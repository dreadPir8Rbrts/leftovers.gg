"""Add expansions_v2 and cards_v2 tables for V2 API catalog data.

Revision ID: 0016
Revises: 0015
Create Date: 2026-04-06

Replaces TCGdex-sourced tables (series/sets/cards) as the active catalog layer.
Supports multi-game (pokemon, onepiece) and multi-language data from the V2 API.

Key design decisions:
  - UUID PKs (synthetic) — V2 API external IDs are unique per game, not globally
  - UNIQUE(game, external_id) is the business key used for all upserts
  - cards_v2.variants stores the full V2 API variant response including prices
  - cards_v2.price_data_uploaded_at tracks freshness of embedded price data
  - Game-specific nullable columns rather than separate tables (consistent with
    existing cards table pattern; no ENUM types per project convention)
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # expansions_v2
    # ------------------------------------------------------------------
    op.create_table(
        "expansions_v2",
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("external_id", sa.String(), nullable=False),
        sa.Column("game", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        # Pokemon-only
        sa.Column("series", sa.String(), nullable=True),
        sa.Column("code", sa.String(), nullable=True),
        sa.Column("printed_total", sa.Integer(), nullable=True),
        sa.Column("is_online_only", sa.Boolean(), nullable=True),
        sa.Column("symbol_url", sa.String(), nullable=True),
        sa.Column("translation", sa.String(), nullable=True),
        # One Piece-only
        sa.Column("type", sa.String(), nullable=True),
        # Shared
        sa.Column("total", sa.Integer(), nullable=True),
        sa.Column("language", sa.String(), nullable=False),
        sa.Column("language_code", sa.String(5), nullable=False),
        sa.Column("release_date", sa.Date(), nullable=True),
        sa.Column("logo_url", sa.String(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_expansions_v2"),
        sa.UniqueConstraint("game", "external_id", name="uq_expansions_v2_game_external_id"),
        sa.CheckConstraint("game IN ('pokemon', 'onepiece')", name="ck_expansions_v2_game"),
        schema="public",
    )

    # ------------------------------------------------------------------
    # cards_v2
    # ------------------------------------------------------------------
    op.create_table(
        "cards_v2",
        # Shared fields
        sa.Column("id", UUID(as_uuid=True), nullable=False),
        sa.Column("external_id", sa.String(), nullable=False),
        sa.Column("game", sa.String(), nullable=False),
        sa.Column("expansion_id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("number", sa.String(), nullable=True),
        sa.Column("printed_number", sa.String(), nullable=True),
        sa.Column("rarity", sa.String(), nullable=True),
        sa.Column("rarity_code", sa.String(), nullable=True),
        sa.Column("language", sa.String(), nullable=False),
        sa.Column("language_code", sa.String(5), nullable=False),
        sa.Column("expansion_sort_order", sa.Integer(), nullable=True),
        sa.Column("images", JSONB(), nullable=True),
        sa.Column("variants", JSONB(), nullable=True),
        sa.Column("price_data_uploaded_at", sa.DateTime(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(), nullable=False),
        # Pokemon-only fields
        sa.Column("supertype", sa.String(), nullable=True),
        sa.Column("subtypes", JSONB(), nullable=True),
        sa.Column("types", JSONB(), nullable=True),
        sa.Column("hp", sa.String(), nullable=True),
        sa.Column("level", sa.String(), nullable=True),
        sa.Column("evolves_from", JSONB(), nullable=True),
        sa.Column("abilities", JSONB(), nullable=True),
        sa.Column("attacks", JSONB(), nullable=True),
        sa.Column("weaknesses", JSONB(), nullable=True),
        sa.Column("resistances", JSONB(), nullable=True),
        sa.Column("retreat_cost", JSONB(), nullable=True),
        sa.Column("national_pokedex_numbers", JSONB(), nullable=True),
        sa.Column("flavor_text", sa.Text(), nullable=True),
        sa.Column("regulation_mark", sa.String(), nullable=True),
        sa.Column("artist", sa.String(), nullable=True),
        # One Piece-only fields
        sa.Column("cost", sa.String(), nullable=True),
        sa.Column("power", sa.String(), nullable=True),
        sa.Column("attribute", sa.String(), nullable=True),
        sa.Column("card_type", sa.String(), nullable=True),
        sa.Column("colors", JSONB(), nullable=True),
        sa.Column("rules", JSONB(), nullable=True),
        sa.Column("printings", JSONB(), nullable=True),
        sa.Column("tags", JSONB(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_cards_v2"),
        sa.ForeignKeyConstraint(
            ["expansion_id"],
            ["public.expansions_v2.id"],
            name="fk_cards_v2_expansion_id",
        ),
        sa.UniqueConstraint("game", "external_id", name="uq_cards_v2_game_external_id"),
        sa.CheckConstraint("game IN ('pokemon', 'onepiece')", name="ck_cards_v2_game"),
        schema="public",
    )

    op.create_index(
        "ix_cards_v2_expansion_id",
        "cards_v2",
        ["expansion_id"],
        schema="public",
    )

    # GIN trigram index for ILIKE / similarity search on card name.
    # pg_trgm extension is already present (created in migration 0001).
    op.create_index(
        "ix_cards_v2_name_gin",
        "cards_v2",
        ["name"],
        postgresql_using="gin",
        postgresql_ops={"name": "gin_trgm_ops"},
        schema="public",
    )


def downgrade() -> None:
    op.drop_index("ix_cards_v2_name_gin", table_name="cards_v2", schema="public")
    op.drop_index("ix_cards_v2_expansion_id", table_name="cards_v2", schema="public")
    op.drop_table("cards_v2", schema="public")
    op.drop_table("expansions_v2", schema="public")
