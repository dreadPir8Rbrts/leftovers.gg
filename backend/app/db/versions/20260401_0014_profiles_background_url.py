"""Add background_url to profiles table.

Revision ID: 0014
Revises: 0013
Create Date: 2026-04-01

Changes:
  - ADD background_url VARCHAR nullable to public.profiles
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "profiles",
        sa.Column("background_url", sa.String(500), nullable=True),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("profiles", "background_url", schema="public")
