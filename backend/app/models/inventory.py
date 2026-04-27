"""
SQLAlchemy model for unified inventory table.

Table: inventory
Replaces vendor_inventory + collector_inventory.
All users (vendor or collector) store cards here.
Vendor-specific fields (asking_price, is_for_sale, is_for_trade, photo_url)
are nullable/false by default — meaningful only when the owner wants to sell/trade.
status: 'active' (owned) | 'sold' (sold via transaction) | 'traded' (traded away)
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from app.db.session import Base


class Inventory(Base):
    __tablename__ = "inventory"
    __table_args__ = {"schema": "public"}

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    profile_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    card_v2_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.cards_v2.id", ondelete="RESTRICT"),
        nullable=True,
    )
    condition_type: Mapped[str] = mapped_column(String(10), nullable=False)
    condition_ungraded: Mapped[Optional[str]] = mapped_column(String(5), nullable=True)
    grading_company: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    grade: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    grading_company_other: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    acquired_price: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    asking_price: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    is_for_sale: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_for_trade: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    photo_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
