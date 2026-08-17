"""sealed_products catalog + inventory sealed support

Revision ID: 0051
Revises: 0050
Create Date: 2026-08-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Widen condition_ungraded to hold sealed condition strings
    # ------------------------------------------------------------------
    op.alter_column(
        "inventory",
        "condition_ungraded",
        existing_type=sa.VARCHAR(5),
        type_=sa.VARCHAR(20),
        schema="public",
    )

    # ------------------------------------------------------------------
    # 2. Update condition_type constraint to allow 'sealed'
    # ------------------------------------------------------------------
    op.drop_constraint("ck_inventory_condition_type", "inventory", schema="public")
    op.create_check_constraint(
        "ck_inventory_condition_type",
        "inventory",
        "condition_type IN ('ungraded', 'graded', 'sealed')",
        schema="public",
    )

    # ------------------------------------------------------------------
    # 3. Update condition_ungraded constraint to allow sealed values
    # ------------------------------------------------------------------
    op.drop_constraint("ck_inventory_condition_ungraded", "inventory", schema="public")
    op.create_check_constraint(
        "ck_inventory_condition_ungraded",
        "inventory",
        "condition_ungraded IS NULL OR condition_ungraded IN "
        "('nm','lp','mp','hp','dmg','factory_sealed','seal_damaged','box_damaged','damaged')",
        schema="public",
    )

    # ------------------------------------------------------------------
    # 4. Update condition integrity constraint to add sealed branch
    # ------------------------------------------------------------------
    op.drop_constraint("ck_inventory_condition_integrity", "inventory", schema="public")
    op.create_check_constraint(
        "ck_inventory_condition_integrity",
        "inventory",
        "(condition_type = 'ungraded' AND condition_ungraded IS NOT NULL "
        " AND condition_ungraded IN ('nm','lp','mp','hp','dmg')"
        " AND grading_company IS NULL AND grade IS NULL) OR "
        "(condition_type = 'graded' AND condition_ungraded IS NULL "
        " AND grading_company IS NOT NULL AND grade IS NOT NULL) OR "
        "(condition_type = 'sealed' AND grading_company IS NULL AND grade IS NULL)",
        schema="public",
    )

    # ------------------------------------------------------------------
    # 5. Create sealed_products catalog table
    # ------------------------------------------------------------------
    op.create_table(
        "sealed_products",
        sa.Column("id", sa.UUID(as_uuid=False), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("game", sa.String(50), nullable=False),
        sa.Column("language_code", sa.String(10), nullable=False),
        sa.Column("product_type", sa.String(50), nullable=False),
        sa.Column(
            "expansion_id",
            sa.UUID(as_uuid=False),
            sa.ForeignKey("public.expansions_v2.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("release_date", sa.Date, nullable=True),
        sa.Column("image_url", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("game IN ('pokemon', 'naruto_ccg')", name="ck_sealed_products_game"),
        sa.CheckConstraint(
            "product_type IN ('booster_pack', 'promo_pack', 'starter_deck', 'blister_box')",
            name="ck_sealed_products_product_type",
        ),
        schema="public",
    )
    op.create_index(
        "ix_sealed_products_game_language",
        "sealed_products",
        ["game", "language_code"],
        schema="public",
    )

    # ------------------------------------------------------------------
    # 6. Add sealed_product_id FK to inventory
    # ------------------------------------------------------------------
    op.add_column(
        "inventory",
        sa.Column(
            "sealed_product_id",
            sa.UUID(as_uuid=False),
            sa.ForeignKey("public.sealed_products.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        schema="public",
    )

    # ------------------------------------------------------------------
    # 7. Mutual exclusion: exactly one of card_v2_id / sealed_product_id
    # ------------------------------------------------------------------
    op.create_check_constraint(
        "ck_inventory_item_type",
        "inventory",
        "(card_v2_id IS NOT NULL AND sealed_product_id IS NULL) OR "
        "(card_v2_id IS NULL AND sealed_product_id IS NOT NULL)",
        schema="public",
    )


def downgrade() -> None:
    op.drop_constraint("ck_inventory_item_type", "inventory", schema="public")
    op.drop_column("inventory", "sealed_product_id", schema="public")

    op.drop_index("ix_sealed_products_game_language", table_name="sealed_products", schema="public")
    op.drop_table("sealed_products", schema="public")

    op.drop_constraint("ck_inventory_condition_integrity", "inventory", schema="public")
    op.create_check_constraint(
        "ck_inventory_condition_integrity",
        "inventory",
        "(condition_type = 'ungraded' AND condition_ungraded IS NOT NULL "
        " AND grading_company IS NULL AND grade IS NULL) OR "
        "(condition_type = 'graded' AND condition_ungraded IS NULL "
        " AND grading_company IS NOT NULL AND grade IS NOT NULL)",
        schema="public",
    )

    op.drop_constraint("ck_inventory_condition_ungraded", "inventory", schema="public")
    op.create_check_constraint(
        "ck_inventory_condition_ungraded",
        "inventory",
        "condition_ungraded IS NULL OR condition_ungraded IN ('nm','lp','mp','hp','dmg')",
        schema="public",
    )

    op.drop_constraint("ck_inventory_condition_type", "inventory", schema="public")
    op.create_check_constraint(
        "ck_inventory_condition_type",
        "inventory",
        "condition_type IN ('ungraded', 'graded')",
        schema="public",
    )

    op.alter_column(
        "inventory",
        "condition_ungraded",
        existing_type=sa.VARCHAR(20),
        type_=sa.VARCHAR(5),
        schema="public",
    )
