"""Add excluded_sold_comps table for per-user comp exclusions.

Revision ID: 0031
Revises: 0030
Create Date: 2026-04-18

Per-user, per-card exclusions of sold_comp rows from price estimation.
Scoped naturally to a single card because sold_comps rows are per-card.
"""

from datetime import datetime
from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0031"
down_revision: Union[str, None] = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "excluded_sold_comps",
        sa.Column("profile_id",   UUID(as_uuid=False), nullable=False),
        sa.Column("sold_comp_id", UUID(as_uuid=False), nullable=False),
        sa.Column("excluded_at",  sa.TIMESTAMP(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("profile_id", "sold_comp_id",
                                name="pk_excluded_sold_comps"),
        sa.ForeignKeyConstraint(["profile_id"],   ["public.profiles.id"],   ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sold_comp_id"], ["public.sold_comps.id"], ondelete="CASCADE"),
        schema="public",
    )
    op.create_index(
        "ix_excluded_sold_comps_profile_id",
        "excluded_sold_comps",
        ["profile_id"],
        schema="public",
    )


def downgrade() -> None:
    op.drop_index("ix_excluded_sold_comps_profile_id", table_name="excluded_sold_comps", schema="public")
    op.drop_table("excluded_sold_comps", schema="public")
