"""Create sold_comps table for storing individual scraped sold listings.

Revision ID: 0025
Revises: 0024
Create Date: 2026-04-10

Notes:
- Stores individual eBay sold listing data per card, sourced by the
  cardops-scraper droplet service which writes directly to Supabase.
- Condition columns mirror the pattern used in inventory tables (migration 0015):
  condition_type + condition_ungraded for raw cards, grading_company + grade
  for slabs.
- listing_url has a unique constraint to prevent duplicate scrape inserts.
- No FK to price_snapshots — sold_comps is a parallel data source, not derived
  from price_snapshots.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0025"
down_revision: Union[str, None] = "0024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sold_comps",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("card_v2_id", sa.UUID(), nullable=False),

        # Source marketplace
        sa.Column("source", sa.VARCHAR(20), nullable=False),

        # Listing content
        sa.Column("title", sa.VARCHAR(500), nullable=False),
        sa.Column("description", sa.TEXT(), nullable=True),
        sa.Column("listing_url", sa.VARCHAR(1000), nullable=False),

        # Sale data
        sa.Column("price", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.VARCHAR(3), nullable=False, server_default="USD"),
        sa.Column("sold_date", sa.DateTime(), nullable=True),

        # Condition — mirrors inventory tables (migration 0015)
        sa.Column("condition_type", sa.VARCHAR(10), nullable=True),       # 'ungraded' | 'graded' | null (unknown)
        sa.Column("condition_ungraded", sa.VARCHAR(5), nullable=True),    # 'nm'|'lp'|'mp'|'hp'|'dmg'
        sa.Column("grading_company", sa.VARCHAR(10), nullable=True),      # 'psa'|'bgs'|'cgc'|'other'
        sa.Column("grade", sa.VARCHAR(30), nullable=True),                # e.g. "10", "9.5"
        sa.Column("grading_company_other", sa.VARCHAR(100), nullable=True),

        sa.Column("fetched_at", sa.DateTime(), nullable=False),

        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["card_v2_id"],
            ["public.cards_v2.id"],
            name="fk_sold_comps_card_v2_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("listing_url", name="uq_sold_comps_listing_url"),
        sa.CheckConstraint(
            "source IN ('ebay')",
            name="ck_sold_comps_source",
        ),
        sa.CheckConstraint(
            "condition_type IS NULL OR condition_type IN ('ungraded', 'graded')",
            name="ck_sold_comps_condition_type",
        ),
        sa.CheckConstraint(
            "condition_ungraded IS NULL OR condition_ungraded IN ('nm','lp','mp','hp','dmg')",
            name="ck_sold_comps_condition_ungraded",
        ),
        sa.CheckConstraint(
            "grading_company IS NULL OR grading_company IN ('psa','bgs','cgc','other')",
            name="ck_sold_comps_grading_company",
        ),
        # Cross-column integrity: if condition_type is set, enforce correct column population
        sa.CheckConstraint(
            "(condition_type IS NULL) OR "
            "(condition_type = 'ungraded' AND condition_ungraded IS NOT NULL "
            " AND grading_company IS NULL AND grade IS NULL) OR "
            "(condition_type = 'graded' AND condition_ungraded IS NULL "
            " AND grading_company IS NOT NULL AND grade IS NOT NULL)",
            name="ck_sold_comps_condition_integrity",
        ),
        schema="public",
    )

    op.create_index(
        "ix_sold_comps_card_v2_id",
        "sold_comps",
        ["card_v2_id"],
        schema="public",
    )
    op.create_index(
        "ix_sold_comps_sold_date",
        "sold_comps",
        ["sold_date"],
        schema="public",
    )
    op.create_index(
        "ix_sold_comps_source",
        "sold_comps",
        ["source"],
        schema="public",
    )


def downgrade() -> None:
    op.drop_index("ix_sold_comps_source", table_name="sold_comps", schema="public")
    op.drop_index("ix_sold_comps_sold_date", table_name="sold_comps", schema="public")
    op.drop_index("ix_sold_comps_card_v2_id", table_name="sold_comps", schema="public")
    op.drop_table("sold_comps", schema="public")
