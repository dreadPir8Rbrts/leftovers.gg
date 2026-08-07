"""Add notifications table.

Revision ID: 0047
Revises: 0046
"""

from alembic import op
import sqlalchemy as sa

revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column(
            "id",
            sa.UUID(),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("profile_id", sa.UUID(), nullable=False),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("actor_id", sa.UUID(), nullable=False),
        sa.Column("entity_id", sa.UUID(), nullable=True),
        sa.Column("read_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"], ["public.profiles.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["actor_id"], ["public.profiles.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="public",
    )
    op.create_index(
        "ix_notifications_profile_id",
        "notifications",
        ["profile_id"],
        schema="public",
    )
    op.create_index(
        "ix_notifications_created_at",
        "notifications",
        ["created_at"],
        schema="public",
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_created_at", table_name="notifications", schema="public")
    op.drop_index("ix_notifications_profile_id", table_name="notifications", schema="public")
    op.drop_table("notifications", schema="public")
