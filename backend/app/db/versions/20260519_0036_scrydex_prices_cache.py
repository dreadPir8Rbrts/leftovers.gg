"""scrydex_prices cache table

Revision ID: 0036
Revises: 0035
Create Date: 2026-05-19
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scrydex_prices",
        sa.Column("card_v2_id", UUID(as_uuid=False), nullable=False),
        sa.Column("prices_json", JSONB(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["card_v2_id"],
            ["public.cards_v2.id"],
            name="fk_scrydex_prices_card_v2_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("card_v2_id"),
        schema="public",
    )


def downgrade() -> None:
    op.drop_table("scrydex_prices", schema="public")
