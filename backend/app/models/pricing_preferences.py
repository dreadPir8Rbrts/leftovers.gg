"""
SQLAlchemy model for public.pricing_preferences.

Per-user overrides for the pricing formula used in condition estimates
and acquired_price computation. Created on first access (not at signup).
Defaults match the hardcoded constants in pricing.py.
"""

from datetime import datetime

from sqlalchemy import CheckConstraint, Integer, Numeric, String, UniqueConstraint
from sqlalchemy import TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class PricingPreferences(Base):
    __tablename__ = "pricing_preferences"
    __table_args__ = (
        UniqueConstraint("profile_id", name="uq_pricing_preferences_profile_id"),
        CheckConstraint("lp_multiplier  BETWEEN 0 AND 1", name="ck_pricing_preferences_lp_multiplier"),
        CheckConstraint("mp_multiplier  BETWEEN 0 AND 1", name="ck_pricing_preferences_mp_multiplier"),
        CheckConstraint("hp_multiplier  BETWEEN 0 AND 1", name="ck_pricing_preferences_hp_multiplier"),
        CheckConstraint("dmg_multiplier BETWEEN 0 AND 1", name="ck_pricing_preferences_dmg_multiplier"),
        CheckConstraint(
            "graded_comp_window_days IN (7, 14, 30, 60, 90)",
            name="ck_pricing_preferences_window_days",
        ),
        CheckConstraint(
            "graded_aggregation IN ('median', 'median_iqr', 'weighted_recency', 'trimmed_mean')",
            name="ck_pricing_preferences_aggregation",
        ),
        CheckConstraint(
            "graded_iqr_multiplier BETWEEN 0.5 AND 5.0",
            name="ck_pricing_preferences_iqr_multiplier",
        ),
        CheckConstraint(
            "graded_recency_halflife_days BETWEEN 1 AND 90",
            name="ck_pricing_preferences_halflife",
        ),
        CheckConstraint(
            "graded_trim_pct BETWEEN 1 AND 49",
            name="ck_pricing_preferences_trim_pct",
        ),
        {"schema": "public"},
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    profile_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    lp_multiplier: Mapped[float] = mapped_column(Numeric(4, 3), nullable=False, default=0.750)
    mp_multiplier: Mapped[float] = mapped_column(Numeric(4, 3), nullable=False, default=0.550)
    hp_multiplier: Mapped[float] = mapped_column(Numeric(4, 3), nullable=False, default=0.350)
    dmg_multiplier: Mapped[float] = mapped_column(Numeric(4, 3), nullable=False, default=0.150)
    graded_comp_window_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    graded_aggregation: Mapped[str] = mapped_column(String(20), nullable=False, default="median")
    graded_iqr_multiplier: Mapped[float] = mapped_column(Numeric(4, 2), nullable=False, default=2.0)
    graded_recency_halflife_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    graded_trim_pct: Mapped[float] = mapped_column(Numeric(4, 2), nullable=False, default=10.0)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False, default=datetime.utcnow)
