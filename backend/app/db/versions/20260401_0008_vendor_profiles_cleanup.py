"""Vendor profiles table cleanup for schema v2.

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-01

Changes:
  - DROP display_name   (now lives on profiles)
  - DROP tcg_interests  (now lives on profiles)
  - DROP notification_prefs (removed from schema entirely)
  - DROP background_img (removed from schema entirely)
  - DROP avatar_img     (now avatar_url on profiles)
  - Migrate buying_rate / trade_rate: divide by 100 for rows > 1 (% → fraction),
    then change type to NUMERIC(4,3) and add CHECK BETWEEN 0 AND 1
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop columns that now live on profiles or are removed from schema
    op.drop_column("vendor_profiles", "display_name", schema="public")
    op.drop_column("vendor_profiles", "tcg_interests", schema="public")
    op.drop_column("vendor_profiles", "notification_prefs", schema="public")
    op.drop_column("vendor_profiles", "background_img", schema="public")
    op.drop_column("vendor_profiles", "avatar_img", schema="public")

    # Migrate buying_rate and trade_rate from percentage to fraction
    # (existing values > 1 are assumed to be percentages, e.g. 70.00 → 0.700)
    op.execute("""
        UPDATE public.vendor_profiles
        SET buying_rate = buying_rate / 100
        WHERE buying_rate IS NOT NULL AND buying_rate > 1
    """)
    op.execute("""
        UPDATE public.vendor_profiles
        SET trade_rate = trade_rate / 100
        WHERE trade_rate IS NOT NULL AND trade_rate > 1
    """)

    # Change type from NUMERIC(4,2) to NUMERIC(4,3)
    op.execute("""
        ALTER TABLE public.vendor_profiles
        ALTER COLUMN buying_rate TYPE NUMERIC(4,3)
        USING buying_rate::NUMERIC(4,3)
    """)
    op.execute("""
        ALTER TABLE public.vendor_profiles
        ALTER COLUMN trade_rate TYPE NUMERIC(4,3)
        USING trade_rate::NUMERIC(4,3)
    """)

    # Add CHECK constraints for fraction range
    op.create_check_constraint(
        "ck_vendor_profiles_buying_rate",
        "vendor_profiles",
        "buying_rate IS NULL OR buying_rate BETWEEN 0 AND 1",
        schema="public",
    )
    op.create_check_constraint(
        "ck_vendor_profiles_trade_rate",
        "vendor_profiles",
        "trade_rate IS NULL OR trade_rate BETWEEN 0 AND 1",
        schema="public",
    )


def downgrade() -> None:
    op.drop_constraint("ck_vendor_profiles_trade_rate", "vendor_profiles", schema="public")
    op.drop_constraint("ck_vendor_profiles_buying_rate", "vendor_profiles", schema="public")

    op.execute("""
        ALTER TABLE public.vendor_profiles
        ALTER COLUMN trade_rate TYPE NUMERIC(4,2)
        USING trade_rate::NUMERIC(4,2)
    """)
    op.execute("""
        ALTER TABLE public.vendor_profiles
        ALTER COLUMN buying_rate TYPE NUMERIC(4,2)
        USING buying_rate::NUMERIC(4,2)
    """)

    # Re-add dropped columns
    op.add_column(
        "vendor_profiles",
        sa.Column("avatar_img", sa.String(), nullable=True),
        schema="public",
    )
    op.add_column(
        "vendor_profiles",
        sa.Column("background_img", sa.String(), nullable=True),
        schema="public",
    )
    op.add_column(
        "vendor_profiles",
        sa.Column("notification_prefs", sa.JSON(), nullable=True),
        schema="public",
    )
    op.add_column(
        "vendor_profiles",
        sa.Column("tcg_interests", sa.JSON(), nullable=True),
        schema="public",
    )
    op.add_column(
        "vendor_profiles",
        sa.Column("display_name", sa.String(), nullable=False, server_default=""),
        schema="public",
    )
