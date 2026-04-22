"""
SQLAlchemy models for collector-side features.

Tables: wishlists
Note: collector_inventory was merged into the unified inventory table (migration 0023).
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, Numeric, String, Text
from sqlalchemy import TIMESTAMP, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from app.db.session import Base


class Wishlist(Base):
    __tablename__ = "wishlists"
    __table_args__ = (
        UniqueConstraint("profile_id", "card_id", name="uq_wishlists_profile_card"),
        {"schema": "public"},
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    profile_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    card_id: Mapped[str] = mapped_column(String(50), nullable=False)  # FK enforced at DB level
    max_price: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    desired_condition: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)
