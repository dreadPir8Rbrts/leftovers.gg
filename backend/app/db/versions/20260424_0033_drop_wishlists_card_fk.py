"""Drop stale wishlists_card_id_fkey (pointed at legacy cards table, not cards_v2)

Revision ID: 0033
Revises: 0032
Create Date: 2026-04-24
"""

from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("wishlists_card_id_fkey", "wishlists", schema="public", type_="foreignkey")


def downgrade() -> None:
    op.create_foreign_key(
        "wishlists_card_id_fkey",
        "wishlists",
        "cards",
        ["card_id"],
        ["id"],
        source_schema="public",
        referent_schema="public",
    )
