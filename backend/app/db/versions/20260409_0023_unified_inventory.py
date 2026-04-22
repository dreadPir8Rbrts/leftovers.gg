"""Unify vendor_inventory + collector_inventory into a single inventory table.

Revision ID: 0023
Revises: 0022
Create Date: 2026-04-09

Changes:
  1. Drop FKs on transaction_cards and show_inventory_tags that reference vendor_inventory
  2. Create unified inventory table
  3. Migrate rows from vendor_inventory (cost_basis → acquired_price)
  4. Migrate rows from collector_inventory (card_v2_id = NULL — legacy v1 card_id not carried over)
  5. Re-add FKs on transaction_cards and show_inventory_tags pointing to inventory
  6. Drop collector_inventory
  7. Drop vendor_inventory
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0023"
down_revision: Union[str, None] = "0022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Drop FKs that reference vendor_inventory so we can drop the table
    # ------------------------------------------------------------------
    op.drop_constraint(
        "transaction_cards_inventory_item_id_fkey",
        "transaction_cards",
        schema="public",
        type_="foreignkey",
    )
    op.drop_constraint(
        "show_inventory_tags_inventory_id_fkey",
        "show_inventory_tags",
        schema="public",
        type_="foreignkey",
    )

    # ------------------------------------------------------------------
    # 2. Create unified inventory table
    # ------------------------------------------------------------------
    op.create_table(
        "inventory",
        sa.Column(
            "id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("profile_id", sa.UUID(), nullable=False),
        sa.Column("card_v2_id", sa.UUID(), nullable=True),   # NULL for legacy collector rows
        sa.Column("condition_type", sa.VARCHAR(10), nullable=False),
        sa.Column("condition_ungraded", sa.VARCHAR(5), nullable=True),
        sa.Column("grading_company", sa.VARCHAR(10), nullable=True),
        sa.Column("grade", sa.VARCHAR(30), nullable=True),
        sa.Column("grading_company_other", sa.VARCHAR(100), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("acquired_price", sa.Numeric(10, 2), nullable=True),
        sa.Column("asking_price", sa.Numeric(10, 2), nullable=True),
        sa.Column(
            "is_for_sale", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "is_for_trade", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("photo_url", sa.VARCHAR(), nullable=True),
        sa.Column(
            "status",
            sa.VARCHAR(20),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
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
        sa.PrimaryKeyConstraint("id", name="pk_inventory"),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["public.profiles.id"],
            name="inventory_profile_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["card_v2_id"],
            ["public.cards_v2.id"],
            name="inventory_card_v2_id_fkey",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'sold', 'traded')",
            name="ck_inventory_status",
        ),
        sa.CheckConstraint(
            "condition_type IN ('ungraded', 'graded')",
            name="ck_inventory_condition_type",
        ),
        sa.CheckConstraint(
            "condition_ungraded IS NULL OR condition_ungraded IN ('nm','lp','mp','hp','dmg')",
            name="ck_inventory_condition_ungraded",
        ),
        sa.CheckConstraint(
            "grading_company IS NULL OR grading_company IN ('psa','bgs','cgc','other')",
            name="ck_inventory_grading_company",
        ),
        sa.CheckConstraint(
            "(condition_type = 'ungraded' AND condition_ungraded IS NOT NULL "
            "AND grading_company IS NULL AND grade IS NULL) OR "
            "(condition_type = 'graded' AND condition_ungraded IS NULL "
            "AND grading_company IS NOT NULL AND grade IS NOT NULL)",
            name="ck_inventory_condition_integrity",
        ),
        schema="public",
    )
    op.create_index("ix_inventory_profile_id", "inventory", ["profile_id"], schema="public")
    op.create_index("ix_inventory_card_v2_id", "inventory", ["card_v2_id"], schema="public")
    op.create_index(
        "ix_inventory_active",
        "inventory",
        ["profile_id"],
        schema="public",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # ------------------------------------------------------------------
    # 3. Migrate from vendor_inventory (cost_basis → acquired_price)
    # ------------------------------------------------------------------
    op.execute("""
        INSERT INTO public.inventory (
            id, profile_id, card_v2_id,
            condition_type, condition_ungraded, grading_company, grade, grading_company_other,
            quantity, acquired_price, asking_price, is_for_sale, is_for_trade,
            photo_url, status, notes, created_at, updated_at, deleted_at
        )
        SELECT
            id, profile_id, card_v2_id,
            condition_type, condition_ungraded, grading_company, grade, grading_company_other,
            quantity, cost_basis, asking_price, is_for_sale, is_for_trade,
            photo_url, status, notes, created_at, updated_at, deleted_at
        FROM public.vendor_inventory
    """)

    # ------------------------------------------------------------------
    # 4. Migrate from collector_inventory
    #    card_v2_id = NULL (legacy TCGdex v1 card_id not mappable without lookup)
    #    updated_at defaults to created_at (column did not exist on collector table)
    # ------------------------------------------------------------------
    op.execute("""
        INSERT INTO public.inventory (
            id, profile_id, card_v2_id,
            condition_type, condition_ungraded, grading_company, grade, grading_company_other,
            quantity, acquired_price, asking_price, is_for_sale, is_for_trade,
            photo_url, status, notes, created_at, updated_at, deleted_at
        )
        SELECT
            id, profile_id, NULL,
            condition_type, condition_ungraded, grading_company, grade, grading_company_other,
            quantity, acquired_price, NULL, false, false,
            NULL, 'active', notes, created_at, created_at, deleted_at
        FROM public.collector_inventory
    """)

    # ------------------------------------------------------------------
    # 5. Re-add FKs pointing to inventory
    # ------------------------------------------------------------------
    op.create_foreign_key(
        "transaction_cards_inventory_item_id_fkey",
        "transaction_cards",
        "inventory",
        ["inventory_item_id"],
        ["id"],
        source_schema="public",
        referent_schema="public",
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "show_inventory_tags_inventory_id_fkey",
        "show_inventory_tags",
        "inventory",
        ["inventory_id"],
        ["id"],
        source_schema="public",
        referent_schema="public",
        ondelete="CASCADE",
    )

    # ------------------------------------------------------------------
    # 6. Drop collector_inventory (auto-drops its indexes and FKs)
    # ------------------------------------------------------------------
    op.drop_table("collector_inventory", schema="public")

    # ------------------------------------------------------------------
    # 7. Drop vendor_inventory (auto-drops its indexes and FKs)
    # ------------------------------------------------------------------
    op.drop_table("vendor_inventory", schema="public")


def downgrade() -> None:
    # ------------------------------------------------------------------
    # Recreate vendor_inventory
    # ------------------------------------------------------------------
    op.create_table(
        "vendor_inventory",
        sa.Column(
            "id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("profile_id", sa.UUID(), nullable=False),
        sa.Column("card_id", sa.VARCHAR(), nullable=True),       # legacy dead column
        sa.Column("card_v2_id", sa.UUID(), nullable=True),
        sa.Column("condition_type", sa.VARCHAR(10), nullable=False),
        sa.Column("condition_ungraded", sa.VARCHAR(5), nullable=True),
        sa.Column("grading_company", sa.VARCHAR(10), nullable=True),
        sa.Column("grade", sa.VARCHAR(30), nullable=True),
        sa.Column("grading_company_other", sa.VARCHAR(100), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("cost_basis", sa.Numeric(10, 2), nullable=True),
        sa.Column("asking_price", sa.Numeric(10, 2), nullable=True),
        sa.Column(
            "is_for_sale", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "is_for_trade", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("photo_url", sa.VARCHAR(), nullable=True),
        sa.Column(
            "status",
            sa.VARCHAR(20),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
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
        sa.PrimaryKeyConstraint("id", name="pk_vendor_inventory"),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["public.profiles.id"],
            name="vendor_inventory_profile_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["card_v2_id"],
            ["public.cards_v2.id"],
            name="vendor_inventory_card_v2_id_fkey",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'sold', 'traded')", name="ck_vendor_inventory_status"
        ),
        sa.CheckConstraint(
            "condition_type IN ('ungraded', 'graded')",
            name="ck_vendor_inventory_condition_type",
        ),
        sa.CheckConstraint(
            "condition_ungraded IS NULL OR condition_ungraded IN ('nm','lp','mp','hp','dmg')",
            name="ck_vendor_inventory_condition_ungraded",
        ),
        sa.CheckConstraint(
            "grading_company IS NULL OR grading_company IN ('psa','bgs','cgc','other')",
            name="ck_vendor_inventory_grading_company",
        ),
        sa.CheckConstraint(
            "(condition_type = 'ungraded' AND condition_ungraded IS NOT NULL "
            "AND grading_company IS NULL AND grade IS NULL) OR "
            "(condition_type = 'graded' AND condition_ungraded IS NULL "
            "AND grading_company IS NOT NULL AND grade IS NOT NULL)",
            name="ck_vendor_inventory_condition_integrity",
        ),
        schema="public",
    )
    op.create_index(
        "ix_vendor_inventory_profile_id", "vendor_inventory", ["profile_id"], schema="public"
    )
    op.create_index(
        "ix_vendor_inventory_card_id", "vendor_inventory", ["card_id"], schema="public"
    )
    op.create_index(
        "ix_vendor_inventory_active",
        "vendor_inventory",
        ["profile_id"],
        schema="public",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # Recreate collector_inventory (card_id will be NULL for migrated rows — acceptable)
    op.create_table(
        "collector_inventory",
        sa.Column(
            "id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("profile_id", sa.UUID(), nullable=False),
        sa.Column("card_id", sa.VARCHAR(50), nullable=True),   # nullable — v1 IDs lost in upgrade
        sa.Column("condition_type", sa.VARCHAR(10), nullable=False),
        sa.Column("condition_ungraded", sa.VARCHAR(5), nullable=True),
        sa.Column("grading_company", sa.VARCHAR(10), nullable=True),
        sa.Column("grade", sa.VARCHAR(30), nullable=True),
        sa.Column("grading_company_other", sa.VARCHAR(100), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("acquired_price", sa.Numeric(10, 2), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_collector_inventory"),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["public.profiles.id"],
            name="collector_inventory_profile_id_fkey",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "condition_type IN ('ungraded', 'graded')",
            name="ck_collector_inventory_condition_type",
        ),
        sa.CheckConstraint(
            "condition_ungraded IS NULL OR condition_ungraded IN ('nm','lp','mp','hp','dmg')",
            name="ck_collector_inventory_condition_ungraded",
        ),
        sa.CheckConstraint(
            "grading_company IS NULL OR grading_company IN ('psa','bgs','cgc','other')",
            name="ck_collector_inventory_grading_company",
        ),
        sa.CheckConstraint(
            "(condition_type = 'ungraded' AND condition_ungraded IS NOT NULL "
            "AND grading_company IS NULL AND grade IS NULL) OR "
            "(condition_type = 'graded' AND condition_ungraded IS NULL "
            "AND grading_company IS NOT NULL AND grade IS NOT NULL)",
            name="ck_collector_inventory_condition_integrity",
        ),
        schema="public",
    )
    op.create_index(
        "ix_collector_inventory_profile_id",
        "collector_inventory",
        ["profile_id"],
        schema="public",
    )
    op.create_index(
        "ix_collector_inventory_active",
        "collector_inventory",
        ["profile_id"],
        schema="public",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # Migrate back: rows with card_v2_id → vendor_inventory; rows without → collector_inventory
    op.execute("""
        INSERT INTO public.vendor_inventory (
            id, profile_id, card_v2_id,
            condition_type, condition_ungraded, grading_company, grade, grading_company_other,
            quantity, cost_basis, asking_price, is_for_sale, is_for_trade,
            photo_url, status, notes, created_at, updated_at, deleted_at
        )
        SELECT
            id, profile_id, card_v2_id,
            condition_type, condition_ungraded, grading_company, grade, grading_company_other,
            quantity, acquired_price, asking_price, is_for_sale, is_for_trade,
            photo_url, status, notes, created_at, updated_at, deleted_at
        FROM public.inventory
        WHERE card_v2_id IS NOT NULL
    """)
    op.execute("""
        INSERT INTO public.collector_inventory (
            id, profile_id, card_id,
            condition_type, condition_ungraded, grading_company, grade, grading_company_other,
            quantity, acquired_price, notes, created_at, deleted_at
        )
        SELECT
            id, profile_id, NULL,
            condition_type, condition_ungraded, grading_company, grade, grading_company_other,
            quantity, acquired_price, notes, created_at, deleted_at
        FROM public.inventory
        WHERE card_v2_id IS NULL
    """)

    # Re-point FKs back to vendor_inventory
    op.drop_constraint(
        "transaction_cards_inventory_item_id_fkey",
        "transaction_cards",
        schema="public",
        type_="foreignkey",
    )
    op.drop_constraint(
        "show_inventory_tags_inventory_id_fkey",
        "show_inventory_tags",
        schema="public",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "transaction_cards_inventory_item_id_fkey",
        "transaction_cards",
        "vendor_inventory",
        ["inventory_item_id"],
        ["id"],
        source_schema="public",
        referent_schema="public",
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "show_inventory_tags_inventory_id_fkey",
        "show_inventory_tags",
        "vendor_inventory",
        ["inventory_id"],
        ["id"],
        source_schema="public",
        referent_schema="public",
        ondelete="CASCADE",
    )

    op.drop_table("inventory", schema="public")
