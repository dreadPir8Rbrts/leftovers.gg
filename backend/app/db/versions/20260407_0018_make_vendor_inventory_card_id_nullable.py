"""Make vendor_inventory.card_id nullable (legacy dead column).

Revision ID: 0018
Revises: 0017
Create Date: 2026-04-07

card_id was the original FK to the legacy cards table. Migration 0017 added
card_v2_id as the live column. card_id is now a dead column kept only for
downgrade safety, so it must be nullable to allow new inserts that only set
card_v2_id.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "vendor_inventory",
        "card_id",
        existing_type=sa.String(),
        nullable=True,
        schema="public",
    )


def downgrade() -> None:
    # Restore NOT NULL — only safe if all rows have a non-null card_id value.
    op.alter_column(
        "vendor_inventory",
        "card_id",
        existing_type=sa.String(),
        nullable=False,
        schema="public",
    )
