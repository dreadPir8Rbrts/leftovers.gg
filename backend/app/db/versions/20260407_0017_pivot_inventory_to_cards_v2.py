"""Pivot vendor_inventory and price_snapshots to reference cards_v2.

Revision ID: 0017
Revises: 0016
Create Date: 2026-04-07

Changes:
  - vendor_inventory: add card_v2_id UUID FK → cards_v2.id (nullable; old card_id
    kept as dead column until backend fully live)
  - price_snapshots: add card_v2_id UUID FK → cards_v2.id; replace unique constraint
    and index from card_id to card_v2_id

Both tables retain their old card_id columns so this migration is fully reversible
and safe even if partial data exists.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID


revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # vendor_inventory — add card_v2_id alongside existing card_id
    # ------------------------------------------------------------------
    op.add_column(
        "vendor_inventory",
        sa.Column("card_v2_id", UUID(as_uuid=True), nullable=True),
        schema="public",
    )
    op.create_foreign_key(
        "vendor_inventory_card_v2_id_fkey",
        "vendor_inventory",
        "cards_v2",
        ["card_v2_id"],
        ["id"],
        source_schema="public",
        referent_schema="public",
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_vendor_inventory_card_v2_id",
        "vendor_inventory",
        ["card_v2_id"],
        schema="public",
    )

    # ------------------------------------------------------------------
    # price_snapshots — add card_v2_id, replace unique constraint + index
    # ------------------------------------------------------------------
    op.add_column(
        "price_snapshots",
        sa.Column("card_v2_id", UUID(as_uuid=True), nullable=True),
        schema="public",
    )
    op.create_foreign_key(
        "price_snapshots_card_v2_id_fkey",
        "price_snapshots",
        "cards_v2",
        ["card_v2_id"],
        ["id"],
        source_schema="public",
        referent_schema="public",
        ondelete="CASCADE",
    )

    # Drop the old unique constraint (card_id, source, variant) and index
    op.drop_constraint(
        "uq_price_snapshots_card_source_variant",
        "price_snapshots",
        type_="unique",
    )
    op.drop_index("ix_price_snapshots_card_id", table_name="price_snapshots")

    # Add new unique constraint and index keyed to card_v2_id
    op.create_unique_constraint(
        "uq_price_snapshots_card_v2_source_variant",
        "price_snapshots",
        ["card_v2_id", "source", "variant"],
    )
    op.create_index(
        "ix_price_snapshots_card_v2_id",
        "price_snapshots",
        ["card_v2_id"],
    )


def downgrade() -> None:
    # price_snapshots — reverse
    op.drop_index("ix_price_snapshots_card_v2_id", table_name="price_snapshots")
    op.drop_constraint(
        "uq_price_snapshots_card_v2_source_variant",
        "price_snapshots",
        type_="unique",
    )
    op.create_index("ix_price_snapshots_card_id", "price_snapshots", ["card_id"])
    op.create_unique_constraint(
        "uq_price_snapshots_card_source_variant",
        "price_snapshots",
        ["card_id", "source", "variant"],
    )
    op.drop_constraint(
        "price_snapshots_card_v2_id_fkey",
        "price_snapshots",
        type_="foreignkey",
    )
    op.drop_column("price_snapshots", "card_v2_id", schema="public")

    # vendor_inventory — reverse
    op.drop_index("ix_vendor_inventory_card_v2_id", table_name="vendor_inventory", schema="public")
    op.drop_constraint(
        "vendor_inventory_card_v2_id_fkey",
        "vendor_inventory",
        type_="foreignkey",
    )
    op.drop_column("vendor_inventory", "card_v2_id", schema="public")
