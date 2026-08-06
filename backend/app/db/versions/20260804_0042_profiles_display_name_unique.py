"""Add unique constraint and index on profiles.display_name (case-insensitive).

Revision ID: 0042
Revises: 0041
"""

from alembic import op
import sqlalchemy as sa

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Unique index using lower() so 'Alice' and 'alice' are treated as the same name.
    # Partial: excludes NULL rows (profiles that haven't set a display name yet).
    op.execute(
        """
        CREATE UNIQUE INDEX uix_profiles_display_name_lower
        ON public.profiles (lower(display_name))
        WHERE display_name IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.uix_profiles_display_name_lower")
