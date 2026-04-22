"""Profiles table cleanup for schema v2.

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-01

Changes:
  - ADD is_public BOOLEAN NOT NULL DEFAULT false
  - ADD created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  - Migrate tcg_interests from JSON to JSONB, add DEFAULT '[]'
  - Update role constraint: remove 'admin', keep vendor|collector|both
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add missing columns
    op.add_column(
        "profiles",
        sa.Column(
            "is_public",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        schema="public",
    )
    op.add_column(
        "profiles",
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="public",
    )

    # Migrate tcg_interests from JSON to JSONB with a default
    op.execute("""
        ALTER TABLE public.profiles
        ALTER COLUMN tcg_interests TYPE JSONB
        USING COALESCE(tcg_interests::text::jsonb, '[]'::jsonb)
    """)
    op.execute("""
        ALTER TABLE public.profiles
        ALTER COLUMN tcg_interests SET DEFAULT '[]'::jsonb
    """)

    # Update role constraint: drop admin, keep vendor|collector|both
    op.execute("ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS ck_profiles_role")
    # Migrate any existing admin rows to collector before tightening the constraint
    op.execute("UPDATE public.profiles SET role = 'collector' WHERE role = 'admin'")
    op.execute("""
        ALTER TABLE public.profiles
        ADD CONSTRAINT ck_profiles_role
        CHECK (role IN ('vendor', 'collector', 'both'))
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS ck_profiles_role")
    op.execute("""
        ALTER TABLE public.profiles
        ADD CONSTRAINT ck_profiles_role
        CHECK (role IN ('vendor', 'collector', 'both', 'admin'))
    """)

    op.execute("""
        ALTER TABLE public.profiles
        ALTER COLUMN tcg_interests TYPE JSON
        USING tcg_interests::text::json
    """)
    op.execute("ALTER TABLE public.profiles ALTER COLUMN tcg_interests DROP DEFAULT")

    op.drop_column("profiles", "created_at", schema="public")
    op.drop_column("profiles", "is_public", schema="public")
