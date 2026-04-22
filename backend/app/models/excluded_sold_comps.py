"""
SQLAlchemy model for public.excluded_sold_comps.

Per-user exclusions of specific sold_comp rows from price estimation.
Naturally scoped per-card since sold_comps rows are per-card.
"""

from datetime import datetime

from sqlalchemy import TIMESTAMP, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ExcludedSoldComp(Base):
    __tablename__ = "excluded_sold_comps"
    __table_args__ = {"schema": "public"}

    profile_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.profiles.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    sold_comp_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.sold_comps.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    excluded_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        default=datetime.utcnow,
    )
