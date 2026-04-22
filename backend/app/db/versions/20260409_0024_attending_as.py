"""Add attending_as to profile_show_registrations.

Revision ID: 0024
Revises: 0023
Create Date: 2026-04-09

Changes:
  1. Add attending_as VARCHAR(20) CHECK('vendor', 'collector') — nullable
  2. Backfill from profiles.role for existing rows
     (no 'both' rows exist after migration 0022)
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0024"
down_revision: Union[str, None] = "0023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Add attending_as column (nullable — existing rows backfilled below)
    # ------------------------------------------------------------------
    op.add_column(
        "profile_show_registrations",
        sa.Column("attending_as", sa.VARCHAR(20), nullable=True),
        schema="public",
    )
    op.create_check_constraint(
        "ck_profile_show_registrations_attending_as",
        "profile_show_registrations",
        "attending_as IS NULL OR attending_as IN ('vendor', 'collector')",
        schema="public",
    )

    # ------------------------------------------------------------------
    # 2. Backfill from profiles.role
    # ------------------------------------------------------------------
    op.execute("""
        UPDATE public.profile_show_registrations psr
        SET attending_as = p.role
        FROM public.profiles p
        WHERE p.id = psr.profile_id
    """)


def downgrade() -> None:
    op.drop_constraint(
        "ck_profile_show_registrations_attending_as",
        "profile_show_registrations",
        schema="public",
    )
    op.drop_column("profile_show_registrations", "attending_as", schema="public")
