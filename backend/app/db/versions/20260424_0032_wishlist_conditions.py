"""wishlist_conditions table; drop desired_condition from wishlists

Revision ID: 0032
Revises: 0031
Create Date: 2026-04-24
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wishlist_conditions",
        sa.Column("id", UUID(as_uuid=False), primary_key=True, nullable=False),
        sa.Column(
            "wishlist_item_id",
            UUID(as_uuid=False),
            sa.ForeignKey("public.wishlists.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("condition_type", sa.String(10), nullable=False),
        sa.Column("condition_ungraded", sa.String(10), nullable=True),
        sa.Column("grading_company", sa.String(20), nullable=True),
        sa.Column("grading_company_other", sa.String(50), nullable=True),
        sa.Column("grade", sa.String(20), nullable=True),
        sa.CheckConstraint(
            "condition_type IN ('ungraded', 'graded')",
            name="ck_wishlist_conditions_type",
        ),
        schema="public",
    )

    op.drop_column("wishlists", "desired_condition", schema="public")


def downgrade() -> None:
    op.add_column(
        "wishlists",
        sa.Column("desired_condition", sa.String(20), nullable=True),
        schema="public",
    )
    op.drop_table("wishlist_conditions", schema="public")
