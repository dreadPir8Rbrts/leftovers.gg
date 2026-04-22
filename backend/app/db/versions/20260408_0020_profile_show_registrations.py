"""Replace vendor_show_registrations with profile_show_registrations.

Revision ID: 0020
Revises: 0019
Create Date: 2026-04-08

Generalises show attendance so any profile (vendor or collector) can register
for a show, rather than requiring a vendor_profile row.

Steps:
  1. Create profile_show_registrations (FK → profiles.id)
  2. Migrate existing vendor registrations (join through vendor_profiles)
  3. Drop index + vendor_show_registrations table
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Create profile_show_registrations
    # ------------------------------------------------------------------
    op.create_table(
        "profile_show_registrations",
        sa.Column(
            "id",
            sa.UUID(),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("profile_id", sa.UUID(), nullable=False),
        sa.Column("show_id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_profile_show_registrations"),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["public.profiles.id"],
            name="profile_show_registrations_profile_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["show_id"],
            ["public.card_shows.id"],
            name="profile_show_registrations_show_id_fkey",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "profile_id", "show_id", name="uq_profile_show_registrations"
        ),
        schema="public",
    )

    op.create_index(
        "ix_profile_show_registrations_show_id",
        "profile_show_registrations",
        ["show_id"],
        schema="public",
    )

    # ------------------------------------------------------------------
    # 2. Migrate existing vendor registrations into the new table
    # ------------------------------------------------------------------
    op.execute(
        """
        INSERT INTO public.profile_show_registrations (id, profile_id, show_id, created_at)
        SELECT vsr.id, vp.profile_id, vsr.show_id, vsr.created_at
        FROM public.vendor_show_registrations vsr
        JOIN public.vendor_profiles vp ON vp.id = vsr.vendor_profile_id
        ON CONFLICT DO NOTHING
        """
    )

    # ------------------------------------------------------------------
    # 3. Drop vendor_show_registrations
    # ------------------------------------------------------------------
    op.drop_index(
        "ix_vendor_show_registrations_show_id",
        table_name="vendor_show_registrations",
        schema="public",
    )
    op.drop_table("vendor_show_registrations", schema="public")


def downgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Recreate vendor_show_registrations
    # ------------------------------------------------------------------
    op.create_table(
        "vendor_show_registrations",
        sa.Column(
            "id",
            sa.UUID(),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("vendor_profile_id", sa.UUID(), nullable=False),
        sa.Column("show_id", sa.UUID(), nullable=False),
        sa.Column("table_number", sa.VARCHAR(20), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
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
        sa.UniqueConstraint(
            "vendor_profile_id", "show_id", name="uq_vendor_show_registrations"
        ),
        schema="public",
    )

    op.create_index(
        "ix_vendor_show_registrations_show_id",
        "vendor_show_registrations",
        ["show_id"],
        schema="public",
    )

    # Migrate vendor registrations back (collector-only rows are lost — acceptable for downgrade)
    op.execute(
        """
        INSERT INTO public.vendor_show_registrations (id, vendor_profile_id, show_id, created_at)
        SELECT psr.id, vp.id, psr.show_id, psr.created_at
        FROM public.profile_show_registrations psr
        JOIN public.vendor_profiles vp ON vp.profile_id = psr.profile_id
        ON CONFLICT DO NOTHING
        """
    )

    # ------------------------------------------------------------------
    # 2. Drop profile_show_registrations
    # ------------------------------------------------------------------
    op.drop_index(
        "ix_profile_show_registrations_show_id",
        table_name="profile_show_registrations",
        schema="public",
    )
    op.drop_table("profile_show_registrations", schema="public")
