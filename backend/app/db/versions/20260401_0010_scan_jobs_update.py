"""scan_jobs schema v2 updates.

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-01

Changes:
  - ADD scan_method VARCHAR(20) NOT NULL DEFAULT 'full_scan'
  - ALTER image_s3_key to nullable (quick-scan / OCR flows have no S3 key)
  - DROP + recreate action CHECK (add log_purchase / log_trade,
    remove log_sale / log_trade_out / log_trade_in)
  - RENAME vendor_id → profile_id, change FK from vendor_profiles.id → profiles.id
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add scan_method
    op.add_column(
        "scan_jobs",
        sa.Column(
            "scan_method",
            sa.VARCHAR(20),
            nullable=False,
            server_default="full_scan",
        ),
        schema="public",
    )
    op.create_check_constraint(
        "ck_scan_jobs_scan_method",
        "scan_jobs",
        "scan_method IN ('full_scan', 'quick_scan')",
        schema="public",
    )

    # 2. Make image_s3_key nullable
    op.execute("""
        ALTER TABLE public.scan_jobs
        ALTER COLUMN image_s3_key DROP NOT NULL
    """)

    # 3. Update action constraint
    op.drop_constraint("ck_scan_jobs_action", "scan_jobs", schema="public")
    op.create_check_constraint(
        "ck_scan_jobs_action",
        "scan_jobs",
        "action IN ('add_inventory','log_sale','log_purchase','log_trade')",
        schema="public",
    )

    # 4. Add profile_id (nullable first)
    op.add_column(
        "scan_jobs",
        sa.Column("profile_id", sa.UUID(), nullable=True),
        schema="public",
    )

    # 5. Populate profile_id from vendor_profiles join
    op.execute("""
        UPDATE public.scan_jobs sj
        SET profile_id = vp.profile_id
        FROM public.vendor_profiles vp
        WHERE vp.id = sj.vendor_id
    """)

    # 6. Set NOT NULL
    op.execute("""
        ALTER TABLE public.scan_jobs
        ALTER COLUMN profile_id SET NOT NULL
    """)

    # 7. Add FK to profiles.id
    op.create_foreign_key(
        "scan_jobs_profile_id_fkey",
        "scan_jobs",
        "profiles",
        ["profile_id"],
        ["id"],
        source_schema="public",
        referent_schema="public",
        ondelete="CASCADE",
    )

    # 8. Drop old vendor_id FK and column
    op.drop_constraint(
        "scan_jobs_vendor_id_fkey",
        "scan_jobs",
        schema="public",
        type_="foreignkey",
    )
    op.drop_column("scan_jobs", "vendor_id", schema="public")


def downgrade() -> None:
    # Restore vendor_id
    op.add_column(
        "scan_jobs",
        sa.Column("vendor_id", sa.UUID(), nullable=True),
        schema="public",
    )
    op.execute("""
        UPDATE public.scan_jobs sj
        SET vendor_id = vp.id
        FROM public.vendor_profiles vp
        WHERE vp.profile_id = sj.profile_id
    """)
    op.execute("""
        ALTER TABLE public.scan_jobs
        ALTER COLUMN vendor_id SET NOT NULL
    """)
    op.create_foreign_key(
        "scan_jobs_vendor_id_fkey",
        "scan_jobs",
        "vendor_profiles",
        ["vendor_id"],
        ["id"],
        source_schema="public",
        referent_schema="public",
        ondelete="CASCADE",
    )

    # Drop profile_id
    op.drop_constraint(
        "scan_jobs_profile_id_fkey",
        "scan_jobs",
        schema="public",
        type_="foreignkey",
    )
    op.drop_column("scan_jobs", "profile_id", schema="public")

    # Restore action constraint
    op.drop_constraint("ck_scan_jobs_action", "scan_jobs", schema="public")
    op.create_check_constraint(
        "ck_scan_jobs_action",
        "scan_jobs",
        "action IN ('add_inventory','log_sale','log_trade_out','log_trade_in')",
        schema="public",
    )

    # Make image_s3_key NOT NULL again
    op.execute("""
        ALTER TABLE public.scan_jobs
        ALTER COLUMN image_s3_key SET NOT NULL
    """)

    # Drop scan_method
    op.drop_constraint("ck_scan_jobs_scan_method", "scan_jobs", schema="public")
    op.drop_column("scan_jobs", "scan_method", schema="public")
