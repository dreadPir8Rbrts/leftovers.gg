"""Add variant column to transaction_cards.

Mirrors inventory_items.variant (migration 0038) so that live-delta
repricing can scope Scrydex graded price lookups to the correct variant.

Revision ID: 0040
Revises: 0039
"""

from alembic import op
import sqlalchemy as sa

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "transaction_cards",
        sa.Column("variant", sa.String(100), nullable=True),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("transaction_cards", "variant", schema="public")
