"""add grading_cost to inventory and fee_pct to transactions

Revision ID: 0048
Revises: 0047
Create Date: 2026-08-08
"""

from alembic import op
import sqlalchemy as sa

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "inventory",
        sa.Column("grading_cost", sa.Numeric(10, 2), nullable=True),
        schema="public",
    )
    op.add_column(
        "transactions",
        sa.Column("fee_pct", sa.Numeric(5, 4), nullable=True),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("transactions", "fee_pct", schema="public")
    op.drop_column("inventory", "grading_cost", schema="public")
