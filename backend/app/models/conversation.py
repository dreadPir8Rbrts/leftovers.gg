import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, Text, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = {"schema": "public"}

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow
    )


class ConversationParticipant(Base):
    __tablename__ = "conversation_participants"
    __table_args__ = {"schema": "public"}

    conversation_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.conversations.id", ondelete="CASCADE"),
        primary_key=True,
    )
    profile_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    joined_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow
    )


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = {"schema": "public"}

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    conversation_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    sender_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow
    )
    read_at: Mapped[Optional[datetime]] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
