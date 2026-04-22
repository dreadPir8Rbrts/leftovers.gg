"""Create card_shows, vendor_show_registrations, show_inventory_tags tables.

Revision ID: 0011
Revises: 0010
Create Date: 2026-04-01
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "card_shows",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.VARCHAR(200), nullable=False),
        sa.Column("location", sa.VARCHAR(500), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("organizer_profile_id", sa.UUID(), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_card_shows"),
        sa.ForeignKeyConstraint(
            ["organizer_profile_id"],
            ["public.profiles.id"],
            name="card_shows_organizer_profile_id_fkey",
            ondelete="SET NULL",
        ),
        schema="public",
    )
    op.create_index("ix_card_shows_start_date", "card_shows", ["start_date"], schema="public")

    op.create_table(
        "vendor_show_registrations",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("vendor_profile_id", sa.UUID(), nullable=False),
        sa.Column("show_id", sa.UUID(), nullable=False),
        sa.Column("table_number", sa.VARCHAR(20), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_vendor_show_registrations"),
        sa.ForeignKeyConstraint(
            ["vendor_profile_id"],
            ["public.vendor_profiles.id"],
            name="vendor_show_registrations_vendor_profile_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["show_id"],
            ["public.card_shows.id"],
            name="vendor_show_registrations_show_id_fkey",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("vendor_profile_id", "show_id", name="uq_vendor_show_registrations"),
        schema="public",
    )
    op.create_index(
        "ix_vendor_show_registrations_show_id",
        "vendor_show_registrations",
        ["show_id"],
        schema="public",
    )

    op.create_table(
        "show_inventory_tags",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("inventory_id", sa.UUID(), nullable=False),
        sa.Column("show_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_show_inventory_tags"),
        sa.ForeignKeyConstraint(
            ["inventory_id"],
            ["public.vendor_inventory.id"],
            name="show_inventory_tags_inventory_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["show_id"],
            ["public.card_shows.id"],
            name="show_inventory_tags_show_id_fkey",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("inventory_id", "show_id", name="uq_show_inventory_tags"),
        schema="public",
    )


def downgrade() -> None:
    op.drop_table("show_inventory_tags", schema="public")
    op.drop_index(
        "ix_vendor_show_registrations_show_id",
        table_name="vendor_show_registrations",
        schema="public",
    )
    op.drop_table("vendor_show_registrations", schema="public")
    op.drop_index("ix_card_shows_start_date", table_name="card_shows", schema="public")
    op.drop_table("card_shows", schema="public")
