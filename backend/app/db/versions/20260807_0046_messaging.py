"""Add conversations, conversation_participants, and messages tables.

Revision ID: 0046
Revises: 0045
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "conversations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=False),
            primary_key=True,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        schema="public",
    )

    op.create_table(
        "conversation_participants",
        sa.Column(
            "conversation_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("public.conversations.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "profile_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("public.profiles.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "joined_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        schema="public",
    )
    op.create_index(
        "ix_conversation_participants_profile_id",
        "conversation_participants",
        ["profile_id"],
        schema="public",
    )

    op.create_table(
        "messages",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "conversation_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("public.conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sender_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("public.profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("read_at", sa.TIMESTAMP(timezone=True), nullable=True),
        schema="public",
    )
    op.create_index(
        "ix_messages_conversation_id",
        "messages",
        ["conversation_id"],
        schema="public",
    )
    op.create_index("ix_messages_sender_id", "messages", ["sender_id"], schema="public")


def downgrade() -> None:
    op.drop_index("ix_messages_sender_id", table_name="messages", schema="public")
    op.drop_index("ix_messages_conversation_id", table_name="messages", schema="public")
    op.drop_table("messages", schema="public")
    op.drop_index(
        "ix_conversation_participants_profile_id",
        table_name="conversation_participants",
        schema="public",
    )
    op.drop_table("conversation_participants", schema="public")
    op.drop_table("conversations", schema="public")
