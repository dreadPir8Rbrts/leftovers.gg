"""Add NM+/NM-/LP+/LP-/MP+/MP- sub-grade condition values to inventory.

Revision ID: 0053
Revises: 0052
Create Date: 2026-08-21
"""

from alembic import op

revision = "0053"
down_revision = "0052"
branch_labels = None
depends_on = None

_UNGRADED_NEW = (
    "'nm+','nm','nm-','lp+','lp','lp-','mp+','mp','mp-','hp','dmg'"
)
_UNGRADED_OLD = "'nm','lp','mp','hp','dmg'"

_CK_UNGRADED = "ck_inventory_condition_ungraded"
_CK_INTEGRITY = "ck_inventory_condition_integrity"

_INTEGRITY_UNGRADED_NEW = (
    f"(condition_type = 'ungraded' AND condition_ungraded IS NOT NULL "
    f" AND condition_ungraded IN ({_UNGRADED_NEW})"
    f" AND grading_company IS NULL AND grade IS NULL)"
)
_INTEGRITY_UNGRADED_OLD = (
    f"(condition_type = 'ungraded' AND condition_ungraded IS NOT NULL "
    f" AND condition_ungraded IN ({_UNGRADED_OLD})"
    f" AND grading_company IS NULL AND grade IS NULL)"
)

_INTEGRITY_COMMON = (
    " OR "
    "(condition_type = 'graded' AND condition_ungraded IS NULL "
    " AND grading_company IS NOT NULL AND grade IS NOT NULL) OR "
    "(condition_type = 'sealed' AND grading_company IS NULL AND grade IS NULL)"
)


def upgrade() -> None:
    # -- ck_inventory_condition_ungraded --
    op.drop_constraint(_CK_UNGRADED, "inventory", schema="public")
    op.create_check_constraint(
        _CK_UNGRADED,
        "inventory",
        f"condition_ungraded IS NULL OR condition_ungraded IN "
        f"({_UNGRADED_NEW},"
        f"'factory_sealed','seal_damaged','box_damaged','damaged')",
        schema="public",
    )

    # -- ck_inventory_condition_integrity --
    op.drop_constraint(_CK_INTEGRITY, "inventory", schema="public")
    op.create_check_constraint(
        _CK_INTEGRITY,
        "inventory",
        _INTEGRITY_UNGRADED_NEW + _INTEGRITY_COMMON,
        schema="public",
    )


def downgrade() -> None:
    op.drop_constraint(_CK_INTEGRITY, "inventory", schema="public")
    op.create_check_constraint(
        _CK_INTEGRITY,
        "inventory",
        _INTEGRITY_UNGRADED_OLD + _INTEGRITY_COMMON,
        schema="public",
    )

    op.drop_constraint(_CK_UNGRADED, "inventory", schema="public")
    op.create_check_constraint(
        _CK_UNGRADED,
        "inventory",
        f"condition_ungraded IS NULL OR condition_ungraded IN "
        f"({_UNGRADED_OLD},"
        f"'factory_sealed','seal_damaged','box_damaged','damaged')",
        schema="public",
    )
