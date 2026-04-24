"""
SQLAlchemy models for collector-side features.

Tables: wishlists, wishlist_conditions
Note: collector_inventory was merged into the unified inventory table (migration 0023).
"""

from datetime import datetime
from typing import Optional, List

from sqlalchemy import ForeignKey, Numeric, String, Text
from sqlalchemy import TIMESTAMP, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.db.session import Base


class WishlistCondition(Base):
    __tablename__ = "wishlist_conditions"
    __table_args__ = {"schema": "public"}

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    wishlist_item_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("public.wishlists.id", ondelete="CASCADE"),
        nullable=False,
    )
    condition_type: Mapped[str] = mapped_column(String(10), nullable=False)
    condition_ungraded: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    grading_company: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    grading_company_other: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    grade: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)


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
    card_id: Mapped[str] = mapped_column(String(50), nullable=False)
    max_price: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)

    conditions: Mapped[List["WishlistCondition"]] = relationship(
        "WishlistCondition",
        cascade="all, delete-orphan",
        lazy="joined",
    )
