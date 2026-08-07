from datetime import datetime

from sqlalchemy import ForeignKey, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Follow(Base):
    __tablename__ = "follows"
    __table_args__ = {"schema": "public"}

    follower_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    following_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow
    )
