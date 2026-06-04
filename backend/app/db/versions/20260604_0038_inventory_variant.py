"""inventory variant column

Revision ID: 0038
Revises: 0037
Create Date: 2026-06-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "inventory",
        sa.Column("variant", sa.String(100), nullable=True),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("inventory", "variant", schema="public")
