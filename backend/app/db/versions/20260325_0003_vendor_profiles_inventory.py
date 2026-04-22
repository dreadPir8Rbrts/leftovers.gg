"""vendor_profiles and inventory_items tables

Revision ID: 20260325_0003
Revises: 20260318_0002
Create Date: 2026-03-25
"""

from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vendor_profiles",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("profile_id", sa.UUID(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("buying_rate", sa.Numeric(4, 2), nullable=True),
        sa.Column("trade_rate", sa.Numeric(4, 2), nullable=True),
        sa.Column("tcg_interests", sa.JSON(), nullable=True),
        sa.Column("notification_prefs", sa.JSON(), nullable=True),
        sa.Column("is_accounting_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["profile_id"], ["public.profiles.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("profile_id"),
        schema="public",
    )

    op.create_table(
        "inventory_items",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("vendor_id", sa.UUID(), nullable=False),
        sa.Column("card_id", sa.String(), nullable=False),
        sa.Column("condition", sa.String(), nullable=False),
        sa.Column("grading_service", sa.String(), nullable=True),
        sa.Column("cert_number", sa.String(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("cost_basis", sa.Numeric(10, 2), nullable=True),
        sa.Column("asking_price", sa.Numeric(10, 2), nullable=True),
        sa.Column("is_for_sale", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_for_trade", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("photo_url", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["vendor_id"], ["public.vendor_profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["card_id"], ["public.cards.id"]),
        sa.CheckConstraint(
            "condition IN ("
            "'psa_1','psa_2','psa_3','psa_4','psa_5','psa_6','psa_7','psa_8','psa_9','psa_10',"
            "'bgs_1','bgs_2','bgs_3','bgs_4','bgs_5','bgs_6','bgs_7','bgs_8','bgs_9','bgs_10',"
            "'cgc_1','cgc_2','cgc_3','cgc_4','cgc_5','cgc_6','cgc_7','cgc_8','cgc_9','cgc_10',"
            "'sgc_1','sgc_2','sgc_3','sgc_4','sgc_5','sgc_6','sgc_7','sgc_8','sgc_9','sgc_10',"
            "'raw_nm','raw_lp','raw_mp','raw_hp','raw_dmg')",
            name="ck_inventory_items_condition",
        ),
        schema="public",
    )

    op.create_index(
        "ix_inventory_items_vendor_id",
        "inventory_items",
        ["vendor_id"],
        schema="public",
    )
    op.create_index(
        "ix_inventory_items_card_id",
        "inventory_items",
        ["card_id"],
        schema="public",
    )


def downgrade() -> None:
    op.drop_index("ix_inventory_items_card_id", table_name="inventory_items", schema="public")
    op.drop_index("ix_inventory_items_vendor_id", table_name="inventory_items", schema="public")
    op.drop_table("inventory_items", schema="public")
    op.drop_table("vendor_profiles", schema="public")
