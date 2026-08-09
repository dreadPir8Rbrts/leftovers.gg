"""Add featured_card_left_id and featured_card_right_id to profiles.

Revision ID: 0049
Revises: 0048
"""

from alembic import op
import sqlalchemy as sa

revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "profiles",
        sa.Column("featured_card_left_id", sa.UUID(), nullable=True),
        schema="public",
    )
    op.add_column(
        "profiles",
        sa.Column("featured_card_right_id", sa.UUID(), nullable=True),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("profiles", "featured_card_right_id", schema="public")
    op.drop_column("profiles", "featured_card_left_id", schema="public")
