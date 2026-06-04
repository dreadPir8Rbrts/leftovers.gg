"""Enable unaccent extension for accent-insensitive card search.

Revision ID: 0039
Revises: 0038
Create Date: 2026-06-04
"""

from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent;")


def downgrade():
    op.execute("DROP EXTENSION IF EXISTS unaccent;")
