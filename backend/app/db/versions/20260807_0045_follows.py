"""Add follows table for user follow relationships.

Revision ID: 0045
Revises: 0044
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "follows",
        sa.Column(
            "follower_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("public.profiles.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "following_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("public.profiles.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint("follower_id != following_id", name="ck_follows_no_self_follow"),
        schema="public",
    )
    op.create_index("ix_follows_follower_id", "follows", ["follower_id"], schema="public")
    op.create_index("ix_follows_following_id", "follows", ["following_id"], schema="public")


def downgrade() -> None:
    op.drop_index("ix_follows_following_id", table_name="follows", schema="public")
    op.drop_index("ix_follows_follower_id", table_name="follows", schema="public")
    op.drop_table("follows", schema="public")
