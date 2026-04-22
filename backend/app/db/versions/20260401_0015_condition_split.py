"""Split condition into condition_type + structured grading columns.

Revision ID: 0015
Revises: 0014
Create Date: 2026-04-01

Changes (both vendor_inventory and collector_inventory):
  - DROP old condition CHECK constraint
  - DROP grading_service, cert_number (vendor_inventory only — legacy, replaced by new columns)
  - ADD condition_type VARCHAR(10) NOT NULL
  - ADD condition_ungraded VARCHAR(5) NULLABLE  — nm/lp/mp/hp/dmg
  - ADD grading_company VARCHAR(10) NULLABLE    — psa/bgs/cgc/other
  - ADD grade VARCHAR(30) NULLABLE              — e.g. "10", "9.5", "10 (Pristine)"
  - ADD grading_company_other VARCHAR(100) NULLABLE — free text when company='other'
  - Migrate existing rows: ungraded conditions stay ungraded; encoded graded
    conditions (psa_10, bgs_9_5, etc.) are split into company + grade.
  - ADD CHECK constraints for new columns + cross-column integrity constraint
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Old condition values valid in both tables (after migration 0009/0013)
_OLD_CONDITIONS = (
    "('nm','lp','mp','hp','dmg','psa_10','psa_9','psa_8','psa_7',"
    "'bgs_10','bgs_9_5','bgs_9','cgc_10','cgc_9_5','cgc_9')"
)


def _upgrade_table(table: str, drop_legacy_cols: bool = False) -> None:
    """Apply condition split to a single inventory table."""

    # 1. Drop old condition CHECK constraint
    op.drop_constraint(f"ck_{table}_condition", table, schema="public")

    # 2. Drop legacy grading columns (vendor_inventory only — never existed on collector)
    if drop_legacy_cols:
        op.drop_column(table, "grading_service", schema="public")
        op.drop_column(table, "cert_number", schema="public")

    # 3. Add new columns — all nullable initially so we can populate them
    op.add_column(table, sa.Column("condition_type", sa.VARCHAR(10), nullable=True), schema="public")
    op.add_column(table, sa.Column("condition_ungraded", sa.VARCHAR(5), nullable=True), schema="public")
    op.add_column(table, sa.Column("grading_company", sa.VARCHAR(10), nullable=True), schema="public")
    op.add_column(table, sa.Column("grade", sa.VARCHAR(30), nullable=True), schema="public")
    op.add_column(table, sa.Column("grading_company_other", sa.VARCHAR(100), nullable=True), schema="public")

    # 4. Migrate ungraded rows
    op.execute(
        f"UPDATE public.{table} "
        "SET condition_type = 'ungraded', condition_ungraded = condition "
        "WHERE condition IN ('nm','lp','mp','hp','dmg')"
    )

    # 5. Migrate graded rows — PSA
    for old_val, grade_str in [("psa_10", "10"), ("psa_9", "9"), ("psa_8", "8"), ("psa_7", "7")]:
        op.execute(
            f"UPDATE public.{table} "
            f"SET condition_type = 'graded', grading_company = 'psa', grade = '{grade_str}' "
            f"WHERE condition = '{old_val}'"
        )

    # 6. Migrate graded rows — BGS
    for old_val, grade_str in [("bgs_10", "10"), ("bgs_9_5", "9.5"), ("bgs_9", "9")]:
        op.execute(
            f"UPDATE public.{table} "
            f"SET condition_type = 'graded', grading_company = 'bgs', grade = '{grade_str}' "
            f"WHERE condition = '{old_val}'"
        )

    # 7. Migrate graded rows — CGC
    for old_val, grade_str in [("cgc_10", "10"), ("cgc_9_5", "9.5"), ("cgc_9", "9")]:
        op.execute(
            f"UPDATE public.{table} "
            f"SET condition_type = 'graded', grading_company = 'cgc', grade = '{grade_str}' "
            f"WHERE condition = '{old_val}'"
        )

    # 8. Drop old condition column
    op.drop_column(table, "condition", schema="public")

    # 9. Enforce NOT NULL on condition_type
    op.execute(f"ALTER TABLE public.{table} ALTER COLUMN condition_type SET NOT NULL")

    # 10. Individual value CHECK constraints
    op.create_check_constraint(
        f"ck_{table}_condition_type",
        table,
        "condition_type IN ('ungraded', 'graded')",
        schema="public",
    )
    op.create_check_constraint(
        f"ck_{table}_condition_ungraded",
        table,
        "condition_ungraded IS NULL OR condition_ungraded IN ('nm','lp','mp','hp','dmg')",
        schema="public",
    )
    op.create_check_constraint(
        f"ck_{table}_grading_company",
        table,
        "grading_company IS NULL OR grading_company IN ('psa','bgs','cgc','other')",
        schema="public",
    )

    # 11. Cross-column integrity constraint
    op.create_check_constraint(
        f"ck_{table}_condition_integrity",
        table,
        (
            "(condition_type = 'ungraded' AND condition_ungraded IS NOT NULL "
            "AND grading_company IS NULL AND grade IS NULL) OR "
            "(condition_type = 'graded' AND condition_ungraded IS NULL "
            "AND grading_company IS NOT NULL AND grade IS NOT NULL)"
        ),
        schema="public",
    )


def _downgrade_table(table: str, restore_legacy_cols: bool = False) -> None:
    """Reverse condition split for a single inventory table."""

    # 1. Drop new CHECK constraints
    op.drop_constraint(f"ck_{table}_condition_integrity", table, schema="public")
    op.drop_constraint(f"ck_{table}_grading_company", table, schema="public")
    op.drop_constraint(f"ck_{table}_condition_ungraded", table, schema="public")
    op.drop_constraint(f"ck_{table}_condition_type", table, schema="public")

    # 2. Re-add condition column (nullable first)
    op.add_column(table, sa.Column("condition", sa.VARCHAR(20), nullable=True), schema="public")

    # 3. Reconstruct old encoded condition value
    op.execute(f"""
        UPDATE public.{table}
        SET condition = CASE
            WHEN condition_type = 'ungraded' THEN condition_ungraded
            WHEN condition_type = 'graded' AND grading_company = 'psa' THEN
                CASE grade
                    WHEN '10' THEN 'psa_10'
                    WHEN '9'  THEN 'psa_9'
                    WHEN '8'  THEN 'psa_8'
                    WHEN '7'  THEN 'psa_7'
                    ELSE 'hp'
                END
            WHEN condition_type = 'graded' AND grading_company = 'bgs' THEN
                CASE grade
                    WHEN '10'  THEN 'bgs_10'
                    WHEN '9.5' THEN 'bgs_9_5'
                    WHEN '9'   THEN 'bgs_9'
                    ELSE 'hp'
                END
            WHEN condition_type = 'graded' AND grading_company = 'cgc' THEN
                CASE grade
                    WHEN '10'  THEN 'cgc_10'
                    WHEN '9.5' THEN 'cgc_9_5'
                    WHEN '9'   THEN 'cgc_9'
                    ELSE 'hp'
                END
            ELSE 'hp'
        END
    """)

    # 4. Set NOT NULL
    op.execute(f"ALTER TABLE public.{table} ALTER COLUMN condition SET NOT NULL")

    # 5. Add back old CHECK constraint
    op.create_check_constraint(
        f"ck_{table}_condition",
        table,
        f"condition IN {_OLD_CONDITIONS}",
        schema="public",
    )

    # 6. Drop new columns
    op.drop_column(table, "grading_company_other", schema="public")
    op.drop_column(table, "grade", schema="public")
    op.drop_column(table, "grading_company", schema="public")
    op.drop_column(table, "condition_ungraded", schema="public")
    op.drop_column(table, "condition_type", schema="public")

    # 7. Restore legacy grading columns on vendor_inventory
    if restore_legacy_cols:
        op.add_column(table, sa.Column("grading_service", sa.String(), nullable=True), schema="public")
        op.add_column(table, sa.Column("cert_number", sa.String(), nullable=True), schema="public")


def upgrade() -> None:
    _upgrade_table("vendor_inventory", drop_legacy_cols=True)
    _upgrade_table("collector_inventory", drop_legacy_cols=False)


def downgrade() -> None:
    _downgrade_table("collector_inventory", restore_legacy_cols=False)
    _downgrade_table("vendor_inventory", restore_legacy_cols=True)
