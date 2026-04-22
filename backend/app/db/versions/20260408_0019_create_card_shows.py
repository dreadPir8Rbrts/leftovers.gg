"""Rebuild card_shows with scraped-event schema; recreate dependent tables.

Revision ID: 0019
Revises: 0018
Create Date: 2026-04-08

The original card_shows table (migration 0011) held manually-managed show
records with a minimal schema (name, location, start_date, end_date).
This migration replaces it with a scrape-oriented schema sourced from
OnTreasure.com.

Steps:
  1. Drop show_inventory_tags and vendor_show_registrations (depend on card_shows)
  2. Drop old card_shows + its index
  3. Create new card_shows with full scraped-event schema
  4. Recreate vendor_show_registrations and show_inventory_tags (FK to new table)
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


revision: str = "0019"
down_revision: Union[str, None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Drop dependent tables and FK constraints
    # ------------------------------------------------------------------
    op.drop_table("show_inventory_tags", schema="public")
    op.drop_index(
        "ix_vendor_show_registrations_show_id",
        table_name="vendor_show_registrations",
        schema="public",
    )
    op.drop_table("vendor_show_registrations", schema="public")

    # transactions.show_id references card_shows — drop the FK, keep the column
    op.drop_constraint(
        "transactions_show_id_fkey",
        "transactions",
        type_="foreignkey",
        schema="public",
    )

    # ------------------------------------------------------------------
    # 2. Drop old card_shows
    # ------------------------------------------------------------------
    op.drop_index("ix_card_shows_start_date", table_name="card_shows", schema="public")
    op.drop_table("card_shows", schema="public")

    # ------------------------------------------------------------------
    # 3. Create new card_shows with scraped-event schema
    # ------------------------------------------------------------------
    op.create_table(
        "card_shows",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"),
                  nullable=False),
        sa.Column("ontreasure_id", sa.VARCHAR(300), nullable=False),
        sa.Column("source_url", sa.VARCHAR(500), nullable=False),
        sa.Column("name", sa.VARCHAR(300), nullable=False),
        sa.Column("date_start", sa.Date(), nullable=False),
        sa.Column("date_end", sa.Date(), nullable=True),
        sa.Column("time_range", sa.VARCHAR(50), nullable=True),
        sa.Column("venue_name", sa.VARCHAR(300), nullable=True),
        sa.Column("address", sa.VARCHAR(500), nullable=True),
        sa.Column("street", sa.VARCHAR(300), nullable=True),
        sa.Column("city", sa.VARCHAR(100), nullable=True),
        sa.Column("state", sa.VARCHAR(2), nullable=True),
        sa.Column("zip_code", sa.VARCHAR(10), nullable=True),
        sa.Column("latitude", sa.Numeric(9, 6), nullable=True),
        sa.Column("longitude", sa.Numeric(9, 6), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("tags", JSONB(), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column("organizer_name", sa.VARCHAR(200), nullable=True),
        sa.Column("organizer_handle", sa.VARCHAR(200), nullable=True),
        sa.Column("ticket_price", sa.VARCHAR(20), nullable=True),
        sa.Column("table_price", sa.VARCHAR(20), nullable=True),
        sa.Column("poster_url", sa.VARCHAR(500), nullable=True),
        sa.Column("status", sa.VARCHAR(20), nullable=False,
                  server_default="'active'"),
        sa.Column("source", sa.VARCHAR(50), nullable=False,
                  server_default="'ontreasure'"),
        sa.Column("is_verified", sa.Boolean(), nullable=False,
                  server_default="false"),
        sa.Column("last_scraped_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ontreasure_id", name="uq_card_shows_ontreasure_id"),
        sa.CheckConstraint("status IN ('active', 'cancelled')",
                           name="ck_card_shows_status"),
        schema="public",
    )

    op.create_index("idx_card_shows_date_start", "card_shows",
                    ["date_start"], schema="public")
    op.create_index("idx_card_shows_state", "card_shows",
                    ["state"], schema="public")
    op.create_index(
        "idx_card_shows_active",
        "card_shows",
        ["date_start"],
        postgresql_where=sa.text("status = 'active'"),
        schema="public",
    )

    # ------------------------------------------------------------------
    # 4. Restore transactions FK + recreate vendor_show_registrations/show_inventory_tags
    # ------------------------------------------------------------------

    # Restore transactions.show_id FK to new card_shows (column was kept, only FK was dropped)
    op.create_foreign_key(
        "transactions_show_id_fkey",
        "transactions",
        "card_shows",
        ["show_id"],
        ["id"],
        source_schema="public",
        referent_schema="public",
        ondelete="SET NULL",
    )

    op.create_table(
        "vendor_show_registrations",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("vendor_profile_id", sa.UUID(), nullable=False),
        sa.Column("show_id", sa.UUID(), nullable=False),
        sa.Column("table_number", sa.VARCHAR(20), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_vendor_show_registrations"),
        sa.ForeignKeyConstraint(
            ["vendor_profile_id"], ["public.vendor_profiles.id"],
            name="vendor_show_registrations_vendor_profile_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["show_id"], ["public.card_shows.id"],
            name="vendor_show_registrations_show_id_fkey",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("vendor_profile_id", "show_id",
                            name="uq_vendor_show_registrations"),
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
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_show_inventory_tags"),
        sa.ForeignKeyConstraint(
            ["inventory_id"], ["public.vendor_inventory.id"],
            name="show_inventory_tags_inventory_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["show_id"], ["public.card_shows.id"],
            name="show_inventory_tags_show_id_fkey",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("inventory_id", "show_id", name="uq_show_inventory_tags"),
        schema="public",
    )


def downgrade() -> None:
    # Drop recreated dependents
    op.drop_table("show_inventory_tags", schema="public")
    op.drop_index(
        "ix_vendor_show_registrations_show_id",
        table_name="vendor_show_registrations",
        schema="public",
    )
    op.drop_table("vendor_show_registrations", schema="public")

    # Drop transactions FK before dropping card_shows
    op.drop_constraint(
        "transactions_show_id_fkey",
        "transactions",
        type_="foreignkey",
        schema="public",
    )

    # Drop new card_shows
    op.drop_index("idx_card_shows_active", table_name="card_shows", schema="public")
    op.drop_index("idx_card_shows_state", table_name="card_shows", schema="public")
    op.drop_index("idx_card_shows_date_start", table_name="card_shows", schema="public")
    op.drop_table("card_shows", schema="public")

    # Restore old card_shows
    op.create_table(
        "card_shows",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.VARCHAR(200), nullable=False),
        sa.Column("location", sa.VARCHAR(500), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("organizer_profile_id", sa.UUID(), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_card_shows"),
        sa.ForeignKeyConstraint(
            ["organizer_profile_id"], ["public.profiles.id"],
            name="card_shows_organizer_profile_id_fkey",
            ondelete="SET NULL",
        ),
        schema="public",
    )
    op.create_index("ix_card_shows_start_date", "card_shows", ["start_date"], schema="public")

    # Restore dependents
    op.create_table(
        "vendor_show_registrations",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("vendor_profile_id", sa.UUID(), nullable=False),
        sa.Column("show_id", sa.UUID(), nullable=False),
        sa.Column("table_number", sa.VARCHAR(20), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_vendor_show_registrations"),
        sa.ForeignKeyConstraint(
            ["vendor_profile_id"], ["public.vendor_profiles.id"],
            name="vendor_show_registrations_vendor_profile_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["show_id"], ["public.card_shows.id"],
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
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_show_inventory_tags"),
        sa.ForeignKeyConstraint(
            ["inventory_id"], ["public.vendor_inventory.id"],
            name="show_inventory_tags_inventory_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["show_id"], ["public.card_shows.id"],
            name="show_inventory_tags_show_id_fkey",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("inventory_id", "show_id", name="uq_show_inventory_tags"),
        schema="public",
    )

    # Restore transactions FK to restored card_shows
    op.create_foreign_key(
        "transactions_show_id_fkey",
        "transactions",
        "card_shows",
        ["show_id"],
        ["id"],
        source_schema="public",
        referent_schema="public",
        ondelete="SET NULL",
    )
