"""Add pricing_preferences table for per-user customizable pricing formula.

Revision ID: 0029
Revises: 0028
Create Date: 2026-04-18

Stores per-user overrides for:
  - Ungraded condition multipliers (LP/MP/HP/DMG as fraction of NM price)
  - Graded comp aggregation method (median / average / most_recent)
  - Graded comp lookback window in days (7 / 14 / 30)

Defaults match the hardcoded constants previously used in pricing.py.
Row is created on first access (GET /pricing/preferences) — not at signup.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0029"
down_revision: Union[str, None] = "0028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "pricing_preferences",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("profile_id", sa.UUID(), nullable=False),
        sa.Column("lp_multiplier", sa.Numeric(4, 3), nullable=False, server_default="0.750"),
        sa.Column("mp_multiplier", sa.Numeric(4, 3), nullable=False, server_default="0.550"),
        sa.Column("hp_multiplier", sa.Numeric(4, 3), nullable=False, server_default="0.350"),
        sa.Column("dmg_multiplier", sa.Numeric(4, 3), nullable=False, server_default="0.150"),
        sa.Column("graded_comp_window_days", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("graded_aggregation", sa.VARCHAR(15), nullable=False, server_default="median"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.PrimaryKeyConstraint("id", name="pk_pricing_preferences"),
        sa.ForeignKeyConstraint(
            ["profile_id"], ["public.profiles.id"],
            name="fk_pricing_preferences_profile_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("profile_id", name="uq_pricing_preferences_profile_id"),
        sa.CheckConstraint(
            "lp_multiplier BETWEEN 0 AND 1",
            name="ck_pricing_preferences_lp_multiplier",
        ),
        sa.CheckConstraint(
            "mp_multiplier BETWEEN 0 AND 1",
            name="ck_pricing_preferences_mp_multiplier",
        ),
        sa.CheckConstraint(
            "hp_multiplier BETWEEN 0 AND 1",
            name="ck_pricing_preferences_hp_multiplier",
        ),
        sa.CheckConstraint(
            "dmg_multiplier BETWEEN 0 AND 1",
            name="ck_pricing_preferences_dmg_multiplier",
        ),
        sa.CheckConstraint(
            "graded_comp_window_days IN (7, 14, 30)",
            name="ck_pricing_preferences_window_days",
        ),
        sa.CheckConstraint(
            "graded_aggregation IN ('median', 'average', 'most_recent')",
            name="ck_pricing_preferences_aggregation",
        ),
        schema="public",
    )
    op.create_index(
        "ix_pricing_preferences_profile_id",
        "pricing_preferences",
        ["profile_id"],
        schema="public",
    )


def downgrade() -> None:
    op.drop_index("ix_pricing_preferences_profile_id", table_name="pricing_preferences", schema="public")
    op.drop_table("pricing_preferences", schema="public")
