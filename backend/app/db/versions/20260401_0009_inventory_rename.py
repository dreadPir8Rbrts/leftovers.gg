"""Rename inventory_items → vendor_inventory; vendor_id → profile_id FK.

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-01

Changes:
  - RENAME TABLE inventory_items → vendor_inventory
  - ADD profile_id (populated from vendor_profiles join), then set NOT NULL
  - DROP vendor_id FK (inventory_items_vendor_id_fkey) + column
  - DROP old indexes, ADD new (ix_vendor_inventory_profile_id,
    ix_vendor_inventory_card_id, partial on deleted_at IS NULL)
  - Update condition CHECK: add bgs_9_5, cgc_9_5; rename constraint to
    ck_vendor_inventory_condition
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CONDITIONS = (
    "('nm','lp','mp','hp','dmg','psa_10','psa_9','psa_8','psa_7',"
    "'bgs_10','bgs_9_5','bgs_9','cgc_10','cgc_9_5','cgc_9')"
)


def upgrade() -> None:
    # 1. Rename the table
    op.rename_table("inventory_items", "vendor_inventory", schema="public")

    # 2. Add profile_id column (nullable first so we can populate it)
    op.add_column(
        "vendor_inventory",
        sa.Column("profile_id", sa.UUID(), nullable=True),
        schema="public",
    )

    # 3. Populate profile_id from vendor_profiles → profiles join
    op.execute("""
        UPDATE public.vendor_inventory vi
        SET profile_id = vp.profile_id
        FROM public.vendor_profiles vp
        WHERE vp.id = vi.vendor_id
    """)

    # 4. Set NOT NULL now that all rows are populated
    op.execute("""
        ALTER TABLE public.vendor_inventory
        ALTER COLUMN profile_id SET NOT NULL
    """)

    # 5. Add FK to profiles.id
    op.create_foreign_key(
        "vendor_inventory_profile_id_fkey",
        "vendor_inventory",
        "profiles",
        ["profile_id"],
        ["id"],
        source_schema="public",
        referent_schema="public",
        ondelete="CASCADE",
    )

    # 6. Drop old vendor_id FK and column
    op.drop_constraint(
        "inventory_items_vendor_id_fkey",
        "vendor_inventory",
        schema="public",
        type_="foreignkey",
    )
    op.drop_column("vendor_inventory", "vendor_id", schema="public")

    # 7. Drop old indexes — use IF EXISTS because PostgreSQL may or may not
    # carry the original names after a table rename depending on how they were created
    op.execute("DROP INDEX IF EXISTS public.ix_inventory_items_vendor_id")
    op.execute("DROP INDEX IF EXISTS public.ix_inventory_items_card_id")

    # 8. Create new indexes
    op.create_index(
        "ix_vendor_inventory_profile_id",
        "vendor_inventory",
        ["profile_id"],
        schema="public",
    )
    op.create_index(
        "ix_vendor_inventory_card_id",
        "vendor_inventory",
        ["card_id"],
        schema="public",
    )
    op.create_index(
        "ix_vendor_inventory_active",
        "vendor_inventory",
        ["profile_id"],
        schema="public",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # 9. Drop old condition CHECK first (so remapping doesn't violate it),
    #    then migrate existing rows to the v2 condition set, then add new CHECK.
    #    Mappings:  raw_nm/lp/mp/hp/dmg → nm/lp/mp/hp/dmg
    #               psa_1..6, bgs_1..8, cgc_1..8, sgc_* → hp
    #               psa_7..10, bgs_9..10, cgc_9..10 → unchanged (already valid)
    op.drop_constraint(
        "ck_inventory_items_condition",
        "vendor_inventory",
        schema="public",
    )
    op.execute("UPDATE public.vendor_inventory SET condition = 'nm'  WHERE condition = 'raw_nm'")
    op.execute("UPDATE public.vendor_inventory SET condition = 'lp'  WHERE condition = 'raw_lp'")
    op.execute("UPDATE public.vendor_inventory SET condition = 'mp'  WHERE condition = 'raw_mp'")
    op.execute("UPDATE public.vendor_inventory SET condition = 'hp'  WHERE condition = 'raw_hp'")
    op.execute("UPDATE public.vendor_inventory SET condition = 'dmg' WHERE condition = 'raw_dmg'")
    op.execute("""
        UPDATE public.vendor_inventory SET condition = 'hp'
        WHERE condition IN (
            'psa_1','psa_2','psa_3','psa_4','psa_5','psa_6',
            'bgs_1','bgs_2','bgs_3','bgs_4','bgs_5','bgs_6','bgs_7','bgs_8',
            'cgc_1','cgc_2','cgc_3','cgc_4','cgc_5','cgc_6','cgc_7','cgc_8',
            'sgc_1','sgc_2','sgc_3','sgc_4','sgc_5','sgc_6','sgc_7','sgc_8','sgc_9','sgc_10'
        )
    """)
    op.create_check_constraint(
        "ck_vendor_inventory_condition",
        "vendor_inventory",
        f"condition IN {_CONDITIONS}",
        schema="public",
    )


def downgrade() -> None:
    # Reverse condition constraint
    op.drop_constraint(
        "ck_vendor_inventory_condition",
        "vendor_inventory",
        schema="public",
    )
    op.create_check_constraint(
        "ck_inventory_items_condition",
        "vendor_inventory",
        (
            "condition IN ('nm','lp','mp','hp','dmg','psa_10','psa_9','psa_8',"
            "'psa_7','bgs_10','bgs_9','cgc_10','cgc_9')"
        ),
        schema="public",
    )

    # Reverse indexes
    op.drop_index(
        "ix_vendor_inventory_active",
        table_name="vendor_inventory",
        schema="public",
    )
    op.drop_index(
        "ix_vendor_inventory_card_id",
        table_name="vendor_inventory",
        schema="public",
    )
    op.drop_index(
        "ix_vendor_inventory_profile_id",
        table_name="vendor_inventory",
        schema="public",
    )
    op.create_index(
        "ix_inventory_items_card_id",
        "vendor_inventory",
        ["card_id"],
        schema="public",
    )

    # Restore vendor_id column + FK
    op.add_column(
        "vendor_inventory",
        sa.Column("vendor_id", sa.UUID(), nullable=True),
        schema="public",
    )
    op.execute("""
        UPDATE public.vendor_inventory vi
        SET vendor_id = vp.id
        FROM public.vendor_profiles vp
        WHERE vp.profile_id = vi.profile_id
    """)
    op.execute("""
        ALTER TABLE public.vendor_inventory
        ALTER COLUMN vendor_id SET NOT NULL
    """)
    op.create_foreign_key(
        "inventory_items_vendor_id_fkey",
        "vendor_inventory",
        "vendor_profiles",
        ["vendor_id"],
        ["id"],
        source_schema="public",
        referent_schema="public",
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_inventory_items_vendor_id",
        "vendor_inventory",
        ["vendor_id"],
        schema="public",
    )

    # Drop profile_id
    op.drop_constraint(
        "vendor_inventory_profile_id_fkey",
        "vendor_inventory",
        schema="public",
        type_="foreignkey",
    )
    op.drop_column("vendor_inventory", "profile_id", schema="public")

    # Rename table back
    op.rename_table("vendor_inventory", "inventory_items", schema="public")
