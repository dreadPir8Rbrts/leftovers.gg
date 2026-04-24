"""Add show_discovery flag to profile_show_registrations

Per-registration opt-in for show-scoped discovery. When true, the user's
inventory and wishlist are visible to others browsing that show's attendee
cards. Defaults to true so existing registrations are discoverable.

Revision ID: 0034
Revises: 0033
Create Date: 2026-04-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "profile_show_registrations",
        sa.Column("show_discovery", sa.Boolean(), nullable=False, server_default="true"),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("profile_show_registrations", "show_discovery", schema="public")
