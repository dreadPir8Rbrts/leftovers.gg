"""scan_jobs table

Revision ID: 0004
Revises: 0003
Create Date: 2026-03-25
"""

from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scan_jobs",
        sa.Column("id", sa.UUID(), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("vendor_id", sa.UUID(), nullable=False),
        sa.Column("image_s3_key", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("result_card_id", sa.String(), nullable=True),
        sa.Column("result_confidence", sa.Numeric(4, 3), nullable=True),
        sa.Column("result_raw", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["vendor_id"], ["public.vendor_profiles.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "status IN ('pending', 'processing', 'complete', 'failed')",
            name="ck_scan_jobs_status",
        ),
        sa.CheckConstraint(
            "action IN ('add_inventory', 'log_sale', 'log_trade_out', 'log_trade_in')",
            name="ck_scan_jobs_action",
        ),
        schema="public",
    )

    op.create_index(
        "ix_scan_jobs_vendor_id",
        "scan_jobs",
        ["vendor_id"],
        schema="public",
    )
    op.create_index(
        "ix_scan_jobs_status",
        "scan_jobs",
        ["status"],
        schema="public",
    )


def downgrade() -> None:
    op.drop_index("ix_scan_jobs_status", table_name="scan_jobs", schema="public")
    op.drop_index("ix_scan_jobs_vendor_id", table_name="scan_jobs", schema="public")
    op.drop_table("scan_jobs", schema="public")
