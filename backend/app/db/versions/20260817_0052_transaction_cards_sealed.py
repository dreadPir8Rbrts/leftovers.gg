"""Add sealed_product_id to transaction_cards

Revision ID: 0052
Revises: 0051
Create Date: 2026-08-17
"""
from alembic import op
import sqlalchemy as sa

revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Widen condition_ungraded to hold sealed condition strings
    op.alter_column(
        "transaction_cards",
        "condition_ungraded",
        existing_type=sa.VARCHAR(5),
        type_=sa.VARCHAR(20),
        schema="public",
    )

    # 2. Make card_v2_id nullable (sealed items have no card)
    op.alter_column(
        "transaction_cards",
        "card_v2_id",
        existing_type=sa.UUID(as_uuid=False),
        nullable=True,
        schema="public",
    )

    # 3. Add sealed_product_id column
    op.add_column(
        "transaction_cards",
        sa.Column("sealed_product_id", sa.UUID(as_uuid=False), nullable=True),
        schema="public",
    )

    # 4. Add FK constraint separately (more reliable in PostgreSQL via Alembic)
    op.create_foreign_key(
        "fk_transaction_cards_sealed_product_id",
        "transaction_cards",
        "sealed_products",
        ["sealed_product_id"],
        ["id"],
        source_schema="public",
        referent_schema="public",
        ondelete="RESTRICT",
    )

    # 5. Mutual exclusion: exactly one of card_v2_id / sealed_product_id
    op.create_check_constraint(
        "ck_transaction_cards_item_type",
        "transaction_cards",
        "(card_v2_id IS NOT NULL AND sealed_product_id IS NULL) OR "
        "(card_v2_id IS NULL AND sealed_product_id IS NOT NULL)",
        schema="public",
    )


def downgrade() -> None:
    op.drop_constraint("ck_transaction_cards_item_type", "transaction_cards", schema="public")
    op.drop_constraint(
        "fk_transaction_cards_sealed_product_id", "transaction_cards",
        type_="foreignkey", schema="public",
    )
    op.drop_column("transaction_cards", "sealed_product_id", schema="public")
    op.alter_column(
        "transaction_cards",
        "card_v2_id",
        existing_type=sa.UUID(as_uuid=False),
        nullable=False,
        schema="public",
    )
    op.alter_column(
        "transaction_cards",
        "condition_ungraded",
        existing_type=sa.VARCHAR(20),
        type_=sa.VARCHAR(5),
        schema="public",
    )
