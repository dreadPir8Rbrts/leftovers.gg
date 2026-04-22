"""
SQLAlchemy model for scan_jobs.

Each scan job represents one card photo → Claude Vision identification attempt.
scan_method: 'full_scan' (S3 image + Claude Vision) or 'quick_scan' (OCR text only).
"""

from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSON

from app.db.session import Base


class ScanJob(Base):
    __tablename__ = "scan_jobs"
    __table_args__ = {"schema": "public"}

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    profile_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    scan_method: Mapped[str] = mapped_column(String(20), nullable=False, default="full_scan")
    image_s3_key: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    action: Mapped[str] = mapped_column(String, nullable=False)
    result_card_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    result_confidence: Mapped[Optional[Decimal]] = mapped_column(Numeric(4, 3), nullable=True)
    result_raw: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
