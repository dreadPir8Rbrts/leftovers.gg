"""Add is_public flag to inventory items

Allows per-item visibility control on public profiles. Defaults to true
so all existing inventory remains visible.

Revision ID: 0035
Revises: 0034
Create Date: 2026-04-27
"""

import sqlalchemy as sa
from alembic import op

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "inventory",
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default="true"),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("inventory", "is_public", schema="public")
