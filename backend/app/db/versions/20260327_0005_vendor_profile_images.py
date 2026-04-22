"""Add background_img and avatar_img to vendor_profiles.

Revision ID: 0005
Revises: 0004
Create Date: 2026-03-27
"""

from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vendor_profiles",
        sa.Column("background_img", sa.String(), nullable=True),
        schema="public",
    )
    op.add_column(
        "vendor_profiles",
        sa.Column("avatar_img", sa.String(), nullable=True),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("vendor_profiles", "avatar_img", schema="public")
    op.drop_column("vendor_profiles", "background_img", schema="public")
