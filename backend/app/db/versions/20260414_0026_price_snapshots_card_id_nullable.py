"""Make price_snapshots.card_id nullable.

Revision ID: 0026
Revises: 0025
Create Date: 2026-04-14

Notes:
- price_snapshots was originally created with card_id (FK → cards) NOT NULL.
- Migration 0017 added card_v2_id (FK → cards_v2) and replaced the unique
  constraint to use card_v2_id, but left card_id as NOT NULL.
- The scraper service only writes card_v2_id — it has no old cards.id to set —
  so every insert fails with a NOT NULL violation on card_id.
- card_id is now legacy; making it nullable unblocks scraper writes while
  keeping the column available for any rows that were inserted before 0017.
"""

import sqlalchemy as sa
from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "price_snapshots",
        "card_id",
        existing_type=sa.UUID(),
        nullable=True,
        schema="public",
    )


def downgrade() -> None:
    op.alter_column(
        "price_snapshots",
        "card_id",
        existing_type=sa.UUID(),
        nullable=False,
        schema="public",
    )
