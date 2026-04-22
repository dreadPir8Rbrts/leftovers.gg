"""Create transactions and transaction_items tables.

Revision ID: 0012
Revises: 0011
Create Date: 2026-04-01
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "transactions",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("vendor_profile_id", sa.UUID(), nullable=False),
        sa.Column("collector_profile_id", sa.UUID(), nullable=True),
        sa.Column("show_id", sa.UUID(), nullable=True),
        sa.Column("type", sa.VARCHAR(20), nullable=False),
        sa.Column("total_cash", sa.NUMERIC(10, 2), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_transactions"),
        sa.ForeignKeyConstraint(
            ["vendor_profile_id"],
            ["public.vendor_profiles.id"],
            name="transactions_vendor_profile_id_fkey",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["collector_profile_id"],
            ["public.profiles.id"],
            name="transactions_collector_profile_id_fkey",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["show_id"],
            ["public.card_shows.id"],
            name="transactions_show_id_fkey",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "type IN ('sale','purchase','trade')",
            name="ck_transactions_type",
        ),
        schema="public",
    )
    op.create_index(
        "ix_transactions_vendor_profile_id",
        "transactions",
        ["vendor_profile_id"],
        schema="public",
    )
    op.create_index(
        "ix_transactions_created_at",
        "transactions",
        ["created_at"],
        schema="public",
    )

    op.create_table(
        "transaction_items",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("transaction_id", sa.UUID(), nullable=False),
        sa.Column("inventory_id", sa.UUID(), nullable=True),
        sa.Column("card_id", sa.VARCHAR(50), nullable=False),
        sa.Column("condition", sa.VARCHAR(20), nullable=False),
        sa.Column("price", sa.NUMERIC(10, 2), nullable=True),
        sa.Column("direction", sa.VARCHAR(10), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_transaction_items"),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["public.transactions.id"],
            name="transaction_items_transaction_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["inventory_id"],
            ["public.vendor_inventory.id"],
            name="transaction_items_inventory_id_fkey",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["card_id"],
            ["public.cards.id"],
            name="transaction_items_card_id_fkey",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "direction IN ('in','out')",
            name="ck_transaction_items_direction",
        ),
        schema="public",
    )
    op.create_index(
        "ix_transaction_items_transaction_id",
        "transaction_items",
        ["transaction_id"],
        schema="public",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_transaction_items_transaction_id",
        table_name="transaction_items",
        schema="public",
    )
    op.drop_table("transaction_items", schema="public")
    op.drop_index(
        "ix_transactions_created_at",
        table_name="transactions",
        schema="public",
    )
    op.drop_index(
        "ix_transactions_vendor_profile_id",
        table_name="transactions",
        schema="public",
    )
    op.drop_table("transactions", schema="public")
