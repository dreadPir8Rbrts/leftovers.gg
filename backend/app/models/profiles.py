"""
SQLAlchemy model for public.profiles.

Bridge table between auth.users (Supabase-managed) and application data.
Role is 'vendor' or 'collector' — mutable at any time by the user.
Vendor-specific fields (bio, buying_rate, trade_rate, is_accounting_enabled)
are nullable and ignored when role = 'collector'.
"""

from datetime import datetime
from typing import Optional, List

from sqlalchemy import Boolean, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy import TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Profile(Base):
    __tablename__ = "profiles"
    __table_args__ = {"schema": "public"}

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    role: Mapped[str] = mapped_column(String(50), nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    bio: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tcg_interests: Mapped[Optional[List[str]]] = mapped_column(JSONB, nullable=True)
    onboarding_complete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    zip_code: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    background_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    buying_rate: Mapped[Optional[float]] = mapped_column(Numeric(4, 3), nullable=True)
    trade_rate: Mapped[Optional[float]] = mapped_column(Numeric(4, 3), nullable=True)
    is_accounting_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)
