"""Extend pricing_preferences with new aggregation methods and tuning parameters.

Revision ID: 0030
Revises: 0029
Create Date: 2026-04-18

Changes:
  - graded_comp_window_days CHECK: add 14, 60, 90 to allowed set
  - graded_aggregation CHECK: replace old values with median / median_iqr /
    weighted_recency / trimmed_mean
  - Add graded_iqr_multiplier  NUMERIC(4,2) DEFAULT 2.0
  - Add graded_recency_halflife_days INTEGER DEFAULT 30
  - Add graded_trim_pct  NUMERIC(4,2) DEFAULT 10.0
"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "0030"
down_revision: Union[str, None] = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── window_days constraint ──────────────────────────────────────────────
    op.drop_constraint(
        "ck_pricing_preferences_window_days",
        "pricing_preferences",
        schema="public",
    )
    op.create_check_constraint(
        "ck_pricing_preferences_window_days",
        "pricing_preferences",
        "graded_comp_window_days IN (7, 14, 30, 60, 90)",
        schema="public",
    )

    # ── aggregation constraint ──────────────────────────────────────────────
    op.drop_constraint(
        "ck_pricing_preferences_aggregation",
        "pricing_preferences",
        schema="public",
    )
    # Reset any existing rows to 'median' so the new constraint doesn't fail
    op.execute(
        "UPDATE public.pricing_preferences SET graded_aggregation = 'median'"
    )
    op.create_check_constraint(
        "ck_pricing_preferences_aggregation",
        "pricing_preferences",
        "graded_aggregation IN ('median', 'median_iqr', 'weighted_recency', 'trimmed_mean')",
        schema="public",
    )

    # ── new tuning columns ──────────────────────────────────────────────────
    op.add_column(
        "pricing_preferences",
        sa.Column(
            "graded_iqr_multiplier",
            sa.Numeric(4, 2),
            nullable=False,
            server_default="2.0",
        ),
        schema="public",
    )
    op.add_column(
        "pricing_preferences",
        sa.Column(
            "graded_recency_halflife_days",
            sa.Integer,
            nullable=False,
            server_default="30",
        ),
        schema="public",
    )
    op.add_column(
        "pricing_preferences",
        sa.Column(
            "graded_trim_pct",
            sa.Numeric(4, 2),
            nullable=False,
            server_default="10.0",
        ),
        schema="public",
    )

    op.create_check_constraint(
        "ck_pricing_preferences_iqr_multiplier",
        "pricing_preferences",
        "graded_iqr_multiplier BETWEEN 0.5 AND 5.0",
        schema="public",
    )
    op.create_check_constraint(
        "ck_pricing_preferences_halflife",
        "pricing_preferences",
        "graded_recency_halflife_days BETWEEN 1 AND 90",
        schema="public",
    )
    op.create_check_constraint(
        "ck_pricing_preferences_trim_pct",
        "pricing_preferences",
        "graded_trim_pct BETWEEN 1 AND 49",
        schema="public",
    )


def downgrade() -> None:
    op.drop_constraint("ck_pricing_preferences_trim_pct",    "pricing_preferences", schema="public")
    op.drop_constraint("ck_pricing_preferences_halflife",    "pricing_preferences", schema="public")
    op.drop_constraint("ck_pricing_preferences_iqr_multiplier", "pricing_preferences", schema="public")
    op.drop_column("pricing_preferences", "graded_trim_pct",              schema="public")
    op.drop_column("pricing_preferences", "graded_recency_halflife_days", schema="public")
    op.drop_column("pricing_preferences", "graded_iqr_multiplier",        schema="public")

    op.drop_constraint("ck_pricing_preferences_aggregation", "pricing_preferences", schema="public")
    op.execute(
        "UPDATE public.pricing_preferences SET graded_aggregation = 'median'"
    )
    op.create_check_constraint(
        "ck_pricing_preferences_aggregation",
        "pricing_preferences",
        "graded_aggregation IN ('median', 'average', 'most_recent')",
        schema="public",
    )

    op.drop_constraint("ck_pricing_preferences_window_days", "pricing_preferences", schema="public")
    op.create_check_constraint(
        "ck_pricing_preferences_window_days",
        "pricing_preferences",
        "graded_comp_window_days IN (7, 14, 30)",
        schema="public",
    )
