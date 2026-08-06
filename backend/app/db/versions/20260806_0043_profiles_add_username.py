"""Add username to profiles; move unique constraint from display_name to username.

Revision ID: 0043
Revises: 0042
"""

from alembic import op
import sqlalchemy as sa

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "profiles",
        sa.Column("username", sa.String(30), nullable=True),
        schema="public",
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uix_profiles_username_lower
        ON public.profiles (lower(username))
        WHERE username IS NOT NULL
        """
    )
    # Remove the unique constraint that was on display_name
    op.execute("DROP INDEX IF EXISTS public.uix_profiles_display_name_lower")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.uix_profiles_username_lower")
    op.execute(
        """
        CREATE UNIQUE INDEX uix_profiles_display_name_lower
        ON public.profiles (lower(display_name))
        WHERE display_name IS NOT NULL
        """
    )
    op.drop_column("profiles", "username", schema="public")
