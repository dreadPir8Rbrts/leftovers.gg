"""Rebuild transactions for new schema; add status to vendor_inventory.

Revision ID: 0021
Revises: 0020
Create Date: 2026-04-09

Changes:
  1. Add status column to vendor_inventory ('active' | 'sold' | 'traded')
  2. Drop transaction_items (references old cards v1 FK)
  3. Drop transactions (vendor-profile-scoped, missing required fields)
  4. Recreate transactions with profile-agnostic schema + full field set
  5. Recreate transaction_cards referencing cards_v2
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0021"
down_revision: Union[str, None] = "0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Add status to vendor_inventory
    # ------------------------------------------------------------------
    op.add_column(
        "vendor_inventory",
        sa.Column(
            "status",
            sa.VARCHAR(20),
            nullable=False,
            server_default="active",
        ),
        schema="public",
    )
    op.create_check_constraint(
        "ck_vendor_inventory_status",
        "vendor_inventory",
        "status IN ('active', 'sold', 'traded')",
        schema="public",
    )

    # ------------------------------------------------------------------
    # 2. Drop old transaction_items then transactions
    #    (transaction_items has FK to old cards v1 and vendor_inventory)
    # ------------------------------------------------------------------
    op.drop_index(
        "ix_transaction_items_transaction_id",
        table_name="transaction_items",
        schema="public",
    )
    op.drop_table("transaction_items", schema="public")

    op.drop_index("ix_transactions_created_at", table_name="transactions", schema="public")
    op.drop_index("ix_transactions_vendor_profile_id", table_name="transactions", schema="public")
    op.drop_table("transactions", schema="public")

    # ------------------------------------------------------------------
    # 3. Create new transactions
    # ------------------------------------------------------------------
    op.create_table(
        "transactions",
        sa.Column(
            "id",
            sa.UUID(),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("profile_id", sa.UUID(), nullable=False),
        sa.Column("transaction_type", sa.VARCHAR(10), nullable=False),
        sa.Column("transaction_date", sa.Date(), nullable=False),
        sa.Column("marketplace", sa.VARCHAR(100), nullable=True),
        sa.Column("show_id", sa.UUID(), nullable=True),
        sa.Column("counterparty_profile_id", sa.UUID(), nullable=True),
        sa.Column("counterparty_name", sa.VARCHAR(200), nullable=True),
        sa.Column("cash_gained", sa.Numeric(10, 2), nullable=True),
        sa.Column("cash_lost", sa.Numeric(10, 2), nullable=True),
        sa.Column("transaction_value", sa.Numeric(10, 2), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_transactions"),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["public.profiles.id"],
            name="transactions_profile_id_fkey",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["show_id"],
            ["public.card_shows.id"],
            name="transactions_show_id_fkey",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["counterparty_profile_id"],
            ["public.profiles.id"],
            name="transactions_counterparty_profile_id_fkey",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "transaction_type IN ('buy', 'sell', 'trade')",
            name="ck_transactions_type",
        ),
        schema="public",
    )
    op.create_index(
        "ix_transactions_profile_id", "transactions", ["profile_id"], schema="public"
    )
    op.create_index(
        "ix_transactions_transaction_date",
        "transactions",
        ["transaction_date"],
        schema="public",
    )

    # ------------------------------------------------------------------
    # 4. Create transaction_cards
    # ------------------------------------------------------------------
    op.create_table(
        "transaction_cards",
        sa.Column(
            "id",
            sa.UUID(),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("transaction_id", sa.UUID(), nullable=False),
        sa.Column("direction", sa.VARCHAR(6), nullable=False),
        sa.Column("card_v2_id", sa.UUID(), nullable=False),
        sa.Column("inventory_item_id", sa.UUID(), nullable=True),
        sa.Column("condition_type", sa.VARCHAR(10), nullable=False),
        sa.Column("condition_ungraded", sa.VARCHAR(5), nullable=True),
        sa.Column("grading_company", sa.VARCHAR(10), nullable=True),
        sa.Column("grade", sa.VARCHAR(30), nullable=True),
        sa.Column("grading_company_other", sa.VARCHAR(100), nullable=True),
        sa.Column("estimated_value", sa.Numeric(10, 2), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_transaction_cards"),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["public.transactions.id"],
            name="transaction_cards_transaction_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["card_v2_id"],
            ["public.cards_v2.id"],
            name="transaction_cards_card_v2_id_fkey",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["inventory_item_id"],
            ["public.vendor_inventory.id"],
            name="transaction_cards_inventory_item_id_fkey",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "direction IN ('gained', 'lost')",
            name="ck_transaction_cards_direction",
        ),
        schema="public",
    )
    op.create_index(
        "ix_transaction_cards_transaction_id",
        "transaction_cards",
        ["transaction_id"],
        schema="public",
    )


def downgrade() -> None:
    # Drop new tables
    op.drop_index(
        "ix_transaction_cards_transaction_id",
        table_name="transaction_cards",
        schema="public",
    )
    op.drop_table("transaction_cards", schema="public")

    op.drop_index("ix_transactions_transaction_date", table_name="transactions", schema="public")
    op.drop_index("ix_transactions_profile_id", table_name="transactions", schema="public")
    op.drop_table("transactions", schema="public")

    # Remove status from vendor_inventory
    op.drop_constraint(
        "ck_vendor_inventory_status", "vendor_inventory", type_="check", schema="public"
    )
    op.drop_column("vendor_inventory", "status", schema="public")

    # Restore old transactions
    op.create_table(
        "transactions",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("vendor_profile_id", sa.UUID(), nullable=False),
        sa.Column("collector_profile_id", sa.UUID(), nullable=True),
        sa.Column("show_id", sa.UUID(), nullable=True),
        sa.Column("type", sa.VARCHAR(20), nullable=False),
        sa.Column("total_cash", sa.Numeric(10, 2), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
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
        sa.CheckConstraint("type IN ('sale','purchase','trade')", name="ck_transactions_type"),
        schema="public",
    )
    op.create_index(
        "ix_transactions_vendor_profile_id",
        "transactions",
        ["vendor_profile_id"],
        schema="public",
    )
    op.create_index(
        "ix_transactions_created_at", "transactions", ["created_at"], schema="public"
    )

    # Restore old transaction_items
    op.create_table(
        "transaction_items",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("transaction_id", sa.UUID(), nullable=False),
        sa.Column("inventory_id", sa.UUID(), nullable=True),
        sa.Column("card_id", sa.VARCHAR(50), nullable=False),
        sa.Column("condition", sa.VARCHAR(20), nullable=False),
        sa.Column("price", sa.Numeric(10, 2), nullable=True),
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
        sa.CheckConstraint(
            "direction IN ('in','out')", name="ck_transaction_items_direction"
        ),
        schema="public",
    )
    op.create_index(
        "ix_transaction_items_transaction_id",
        "transaction_items",
        ["transaction_id"],
        schema="public",
    )
