"""Add en_name to cards_v2 and name_en to expansions_v2 for cross-language search.

Revision ID: 0028
Revises: 0027
Create Date: 2026-04-17

Notes:
- en_name: English translation of the card name, populated for non-English cards.
- name_en: English translation of the expansion name, populated for non-English expansions.
- Both nullable; backfilled via scripts/backfill_en_names.py using Google Translate.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0028"
down_revision: Union[str, None] = "0027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "cards_v2",
        sa.Column("en_name", sa.VARCHAR(), nullable=True),
        schema="public",
    )
    op.add_column(
        "expansions_v2",
        sa.Column("name_en", sa.VARCHAR(), nullable=True),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("expansions_v2", "name_en", schema="public")
    op.drop_column("cards_v2", "en_name", schema="public")
