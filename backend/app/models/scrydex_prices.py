from datetime import datetime
from typing import Any, List

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ScrydexPrice(Base):
    __tablename__ = "scrydex_prices"
    __table_args__ = {"schema": "public"}

    card_v2_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("public.cards_v2.id", ondelete="CASCADE"),
        primary_key=True,
    )
    prices_json: Mapped[List[Any]] = mapped_column(JSONB(), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False)
