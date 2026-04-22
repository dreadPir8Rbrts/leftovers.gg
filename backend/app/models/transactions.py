"""
SQLAlchemy models for transactions.

Tables:
  transactions      — a buy, sell, or trade event recorded by a user
  transaction_cards — individual cards gained or lost in a transaction

transaction_type: 'buy' | 'sell' | 'trade'
direction:        'gained' | 'lost'  (from the recording user's perspective)
"""

from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy import TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.db.session import Base


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = {"schema": "public"}

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    profile_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )
    transaction_type: Mapped[str] = mapped_column(String(10), nullable=False)
    transaction_date: Mapped[date] = mapped_column(Date(), nullable=False)
    marketplace: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    show_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.card_shows.id", ondelete="SET NULL"),
        nullable=True,
    )
    counterparty_profile_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    counterparty_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    cash_gained: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    cash_lost: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    transaction_value: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)

    cards: Mapped[List["TransactionCard"]] = relationship(
        "TransactionCard", back_populates="transaction", lazy="select"
    )


class TransactionCard(Base):
    __tablename__ = "transaction_cards"
    __table_args__ = {"schema": "public"}

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    transaction_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.transactions.id", ondelete="CASCADE"),
        nullable=False,
    )
    direction: Mapped[str] = mapped_column(String(6), nullable=False)  # 'gained' | 'lost'
    card_v2_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.cards_v2.id", ondelete="RESTRICT"),
        nullable=False,
    )
    inventory_item_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.inventory.id", ondelete="SET NULL"),
        nullable=True,
    )
    condition_type: Mapped[str] = mapped_column(String(10), nullable=False)
    condition_ungraded: Mapped[Optional[str]] = mapped_column(String(5), nullable=True)
    grading_company: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    grade: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    grading_company_other: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    estimated_value: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)

    transaction: Mapped["Transaction"] = relationship("Transaction", back_populates="cards")
