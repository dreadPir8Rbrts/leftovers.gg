"""
SQLAlchemy models for card show management.

Tables:
  card_shows                   — scraped OnTreasure event listings (migration 0019)
  profile_show_registrations   — attendance registrations for any profile (migration 0020)
  show_inventory_tags          — inventory items tagged to a show (Phase 1+)
"""

import uuid
from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import Boolean, CheckConstraint, Date, ForeignKey, Numeric, String, Text
from sqlalchemy import TIMESTAMP, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class CardShow(Base):
    __tablename__ = "card_shows"
    __table_args__ = (
        UniqueConstraint("ontreasure_id", name="uq_card_shows_ontreasure_id"),
        CheckConstraint("status IN ('active', 'cancelled')",
                        name="ck_card_shows_status"),
        {"schema": "public"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True,
                                          server_default="gen_random_uuid()")
    ontreasure_id: Mapped[str] = mapped_column(String(300), nullable=False)
    source_url: Mapped[str] = mapped_column(String(500), nullable=False)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    date_start: Mapped[date] = mapped_column(Date(), nullable=False)
    date_end: Mapped[Optional[date]] = mapped_column(Date(), nullable=True)
    time_range: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    venue_name: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    street: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(2), nullable=True)
    zip_code: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    latitude: Mapped[Optional[float]] = mapped_column(Numeric(9, 6), nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Numeric(9, 6), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text(), nullable=True)
    tags: Mapped[List] = mapped_column(JSONB(), nullable=False,
                                       server_default="'[]'::jsonb")
    organizer_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    organizer_handle: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    ticket_price: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    table_price: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    poster_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False,
                                        server_default="'active'")
    source: Mapped[str] = mapped_column(String(50), nullable=False,
                                        server_default="'ontreasure'")
    is_verified: Mapped[bool] = mapped_column(Boolean(), nullable=False,
                                              server_default="false")
    last_scraped_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True),
                                                 server_default="now()")
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True),
                                                 server_default="now()")


class ProfileShowRegistration(Base):
    __tablename__ = "profile_show_registrations"
    __table_args__ = (
        UniqueConstraint("profile_id", "show_id", name="uq_profile_show_registrations"),
        {"schema": "public"},
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    profile_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    show_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.card_shows.id", ondelete="CASCADE"),
        nullable=False,
    )
    attending_as: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)

    show: Mapped["CardShow"] = relationship("CardShow")


class ShowInventoryTag(Base):
    __tablename__ = "show_inventory_tags"
    __table_args__ = (
        UniqueConstraint("inventory_id", "show_id", name="uq_show_inventory_tags"),
        {"schema": "public"},
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    inventory_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.inventory.id", ondelete="CASCADE"),
        nullable=False,
    )
    show_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.card_shows.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)
