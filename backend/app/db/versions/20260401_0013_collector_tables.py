"""Create collector_inventory and wishlists tables.

Revision ID: 0013
Revises: 0012
Create Date: 2026-04-01
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "collector_inventory",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("profile_id", sa.UUID(), nullable=False),
        sa.Column("card_id", sa.VARCHAR(50), nullable=False),
        sa.Column("condition", sa.VARCHAR(20), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("acquired_price", sa.NUMERIC(10, 2), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_collector_inventory"),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["public.profiles.id"],
            name="collector_inventory_profile_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["card_id"],
            ["public.cards.id"],
            name="collector_inventory_card_id_fkey",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            (
                "condition IN ('nm','lp','mp','hp','dmg','psa_10','psa_9','psa_8','psa_7',"
                "'bgs_10','bgs_9_5','bgs_9','cgc_10','cgc_9_5','cgc_9')"
            ),
            name="ck_collector_inventory_condition",
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
        "ix_collector_inventory_card_id",
        "collector_inventory",
        ["card_id"],
        schema="public",
    )
    op.create_index(
        "ix_collector_inventory_active",
        "collector_inventory",
        ["profile_id"],
        schema="public",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "wishlists",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("profile_id", sa.UUID(), nullable=False),
        sa.Column("card_id", sa.VARCHAR(50), nullable=False),
        sa.Column("max_price", sa.NUMERIC(10, 2), nullable=True),
        sa.Column("desired_condition", sa.VARCHAR(20), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name="pk_wishlists"),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["public.profiles.id"],
            name="wishlists_profile_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["card_id"],
            ["public.cards.id"],
            name="wishlists_card_id_fkey",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("profile_id", "card_id", name="uq_wishlists_profile_card"),
        schema="public",
    )
    op.create_index(
        "ix_wishlists_profile_id",
        "wishlists",
        ["profile_id"],
        schema="public",
    )


def downgrade() -> None:
    op.drop_index("ix_wishlists_profile_id", table_name="wishlists", schema="public")
    op.drop_table("wishlists", schema="public")
    op.drop_index(
        "ix_collector_inventory_active",
        table_name="collector_inventory",
        schema="public",
    )
    op.drop_index(
        "ix_collector_inventory_card_id",
        table_name="collector_inventory",
        schema="public",
    )
    op.drop_index(
        "ix_collector_inventory_profile_id",
        table_name="collector_inventory",
        schema="public",
    )
    op.drop_table("collector_inventory", schema="public")
