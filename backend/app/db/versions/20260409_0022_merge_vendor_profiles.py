"""Merge vendor_profiles into profiles; tighten role to vendor|collector only.

Revision ID: 0022
Revises: 0021
Create Date: 2026-04-09

Changes:
  1. Convert any 'both' role rows to 'vendor' (safety — no rows expected)
  2. Add bio, buying_rate, trade_rate, is_accounting_enabled to profiles
  3. Backfill new columns from vendor_profiles
  4. Replace ck_profiles_role CHECK to allow only 'vendor' | 'collector'
  5. Drop vendor_profiles table
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0022"
down_revision: Union[str, None] = "0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Convert 'both' → 'vendor' before tightening the constraint
    # ------------------------------------------------------------------
    op.execute("UPDATE public.profiles SET role = 'vendor' WHERE role = 'both'")

    # ------------------------------------------------------------------
    # 2. Add vendor-specific columns to profiles (all nullable)
    # ------------------------------------------------------------------
    op.add_column(
        "profiles",
        sa.Column("bio", sa.Text(), nullable=True),
        schema="public",
    )
    op.add_column(
        "profiles",
        sa.Column("buying_rate", sa.Numeric(4, 3), nullable=True),
        schema="public",
    )
    op.add_column(
        "profiles",
        sa.Column("trade_rate", sa.Numeric(4, 3), nullable=True),
        schema="public",
    )
    op.add_column(
        "profiles",
        sa.Column(
            "is_accounting_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        schema="public",
    )

    # ------------------------------------------------------------------
    # 3. Backfill from vendor_profiles
    # ------------------------------------------------------------------
    op.execute("""
        UPDATE public.profiles p
        SET
            bio                  = vp.bio,
            buying_rate          = vp.buying_rate,
            trade_rate           = vp.trade_rate,
            is_accounting_enabled = vp.is_accounting_enabled
        FROM public.vendor_profiles vp
        WHERE vp.profile_id = p.id
    """)

    # ------------------------------------------------------------------
    # 4. Add CHECK constraints for rate columns
    # ------------------------------------------------------------------
    op.create_check_constraint(
        "ck_profiles_buying_rate",
        "profiles",
        "buying_rate IS NULL OR buying_rate BETWEEN 0 AND 1",
        schema="public",
    )
    op.create_check_constraint(
        "ck_profiles_trade_rate",
        "profiles",
        "trade_rate IS NULL OR trade_rate BETWEEN 0 AND 1",
        schema="public",
    )

    # ------------------------------------------------------------------
    # 5. Tighten role constraint: drop 'both', keep vendor|collector only
    # ------------------------------------------------------------------
    op.execute("ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS ck_profiles_role")
    op.execute("""
        ALTER TABLE public.profiles
        ADD CONSTRAINT ck_profiles_role
        CHECK (role IN ('vendor', 'collector'))
    """)

    # ------------------------------------------------------------------
    # 6. Drop vendor_profiles (cascades its own FKs and constraints)
    # ------------------------------------------------------------------
    op.drop_table("vendor_profiles", schema="public")


def downgrade() -> None:
    # ------------------------------------------------------------------
    # Recreate vendor_profiles
    # ------------------------------------------------------------------
    op.create_table(
        "vendor_profiles",
        sa.Column(
            "id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("profile_id", sa.UUID(), nullable=False),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("buying_rate", sa.Numeric(4, 3), nullable=True),
        sa.Column("trade_rate", sa.Numeric(4, 3), nullable=True),
        sa.Column(
            "is_accounting_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_vendor_profiles"),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["public.profiles.id"],
            name="vendor_profiles_profile_id_fkey",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("profile_id", name="uq_vendor_profiles_profile_id"),
        sa.CheckConstraint(
            "buying_rate IS NULL OR buying_rate BETWEEN 0 AND 1",
            name="ck_vendor_profiles_buying_rate",
        ),
        sa.CheckConstraint(
            "trade_rate IS NULL OR trade_rate BETWEEN 0 AND 1",
            name="ck_vendor_profiles_trade_rate",
        ),
        schema="public",
    )

    # Backfill vendor_profiles from profiles (vendor rows only)
    op.execute("""
        INSERT INTO public.vendor_profiles (profile_id, bio, buying_rate, trade_rate, is_accounting_enabled)
        SELECT id, bio, buying_rate, trade_rate, is_accounting_enabled
        FROM public.profiles
        WHERE role = 'vendor'
    """)

    # Remove columns from profiles
    op.drop_constraint("ck_profiles_trade_rate", "profiles", schema="public")
    op.drop_constraint("ck_profiles_buying_rate", "profiles", schema="public")
    op.drop_column("profiles", "is_accounting_enabled", schema="public")
    op.drop_column("profiles", "trade_rate", schema="public")
    op.drop_column("profiles", "buying_rate", schema="public")
    op.drop_column("profiles", "bio", schema="public")

    # Restore role constraint to include 'both'
    op.execute("ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS ck_profiles_role")
    op.execute("""
        ALTER TABLE public.profiles
        ADD CONSTRAINT ck_profiles_role
        CHECK (role IN ('vendor', 'collector', 'both'))
    """)
