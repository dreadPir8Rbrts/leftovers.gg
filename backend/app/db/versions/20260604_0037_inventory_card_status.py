"""Replace is_for_sale / is_for_trade with card_status on inventory

Consolidates two boolean flags into a single discriminator column.
Values: 'pc' | 'fs' | 'ft' | 'fs_ft'

Revision ID: 0037
Revises: 0036
Create Date: 2026-06-04
"""

import sqlalchemy as sa
from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add nullable first so we can populate it before enforcing NOT NULL
    op.add_column(
        "inventory",
        sa.Column("card_status", sa.String(10), nullable=True),
        schema="public",
    )

    op.execute("""
        UPDATE public.inventory
        SET card_status = CASE
            WHEN is_for_sale AND is_for_trade THEN 'fs_ft'
            WHEN is_for_sale                  THEN 'fs'
            WHEN is_for_trade                 THEN 'ft'
            ELSE                                   'pc'
        END
    """)

    op.alter_column("inventory", "card_status", nullable=False, schema="public")
    op.execute("ALTER TABLE public.inventory ALTER COLUMN card_status SET DEFAULT 'pc'")
    op.execute("""
        ALTER TABLE public.inventory
        ADD CONSTRAINT chk_inventory_card_status
        CHECK (card_status IN ('pc', 'fs', 'ft', 'fs_ft'))
    """)

    op.drop_column("inventory", "is_for_sale", schema="public")
    op.drop_column("inventory", "is_for_trade", schema="public")


def downgrade() -> None:
    op.add_column(
        "inventory",
        sa.Column("is_for_sale", sa.Boolean(), nullable=False, server_default="false"),
        schema="public",
    )
    op.add_column(
        "inventory",
        sa.Column("is_for_trade", sa.Boolean(), nullable=False, server_default="false"),
        schema="public",
    )

    op.execute("""
        UPDATE public.inventory SET
            is_for_sale  = card_status IN ('fs', 'fs_ft'),
            is_for_trade = card_status IN ('ft', 'fs_ft')
    """)

    op.execute("ALTER TABLE public.inventory DROP CONSTRAINT chk_inventory_card_status")
    op.drop_column("inventory", "card_status", schema="public")
