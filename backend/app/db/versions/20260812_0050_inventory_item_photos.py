"""inventory_item_photos table

Revision ID: 0050
Revises: 0049
Create Date: 2026-08-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inventory_item_photos",
        sa.Column("id", sa.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "inventory_item_id",
            sa.UUID(as_uuid=False),
            sa.ForeignKey("public.inventory.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "profile_id",
            sa.UUID(as_uuid=False),
            sa.ForeignKey("public.profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("photo_url", sa.String(500), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        schema="public",
    )
    op.create_index(
        "ix_inventory_item_photos_inventory_item_id",
        "inventory_item_photos",
        ["inventory_item_id"],
        schema="public",
    )


def downgrade() -> None:
    op.drop_index("ix_inventory_item_photos_inventory_item_id", table_name="inventory_item_photos", schema="public")
    op.drop_table("inventory_item_photos", schema="public")
