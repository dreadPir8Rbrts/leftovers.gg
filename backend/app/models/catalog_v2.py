"""
SQLAlchemy models for the V2 API catalog tables (v2).

Tables:
  expansions_v2  — TCG set/expansion metadata for all supported games
  cards_v2       — Card metadata with game-specific fields as nullable columns

Both tables use synthetic UUID PKs. The business key is UNIQUE(game, external_id)
which maps to V2 API native IDs (e.g. "base1", "OP13", "base1-4", "OP13-118").
"""

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class ExpansionV2(Base):
    __tablename__ = "expansions_v2"
    __table_args__ = (
        UniqueConstraint("game", "external_id", name="uq_expansions_v2_game_external_id"),
        CheckConstraint("game IN ('pokemon', 'onepiece')", name="ck_expansions_v2_game"),
        {"schema": "public"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_id: Mapped[str] = mapped_column(String(), nullable=False)
    game: Mapped[str] = mapped_column(String(), nullable=False)
    name: Mapped[str] = mapped_column(String(), nullable=False)
    name_en: Mapped[Optional[str]] = mapped_column(String(), nullable=True)

    # Pokemon-only
    series: Mapped[Optional[str]] = mapped_column(String(), nullable=True)
    code: Mapped[Optional[str]] = mapped_column(String(), nullable=True)
    printed_total: Mapped[Optional[int]] = mapped_column(Integer(), nullable=True)
    is_online_only: Mapped[Optional[bool]] = mapped_column(Boolean(), nullable=True)
    symbol_url: Mapped[Optional[str]] = mapped_column(String(), nullable=True)
    translation: Mapped[Optional[str]] = mapped_column(String(), nullable=True)

    # One Piece-only
    type: Mapped[Optional[str]] = mapped_column(String(), nullable=True)

    # Shared
    total: Mapped[Optional[int]] = mapped_column(Integer(), nullable=True)
    language: Mapped[str] = mapped_column(String(), nullable=False)
    language_code: Mapped[str] = mapped_column(String(5), nullable=False)
    release_date: Mapped[Optional[datetime]] = mapped_column(Date(), nullable=True)
    logo_url: Mapped[Optional[str]] = mapped_column(String(), nullable=True)
    last_synced_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False)

    cards: Mapped[List["CardV2"]] = relationship("CardV2", back_populates="expansion")


class CardV2(Base):
    __tablename__ = "cards_v2"
    __table_args__ = (
        UniqueConstraint("game", "external_id", name="uq_cards_v2_game_external_id"),
        CheckConstraint("game IN ('pokemon', 'onepiece')", name="ck_cards_v2_game"),
        {"schema": "public"},
    )

    # Shared fields
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_id: Mapped[str] = mapped_column(String(), nullable=False)
    game: Mapped[str] = mapped_column(String(), nullable=False)
    expansion_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("public.expansions_v2.id", name="fk_cards_v2_expansion_id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(), nullable=False)
    en_name: Mapped[Optional[str]] = mapped_column(String(), nullable=True)
    number: Mapped[Optional[str]] = mapped_column(String(), nullable=True)
    printed_number: Mapped[Optional[str]] = mapped_column(String(), nullable=True)
    rarity: Mapped[Optional[str]] = mapped_column(String(), nullable=True)
    rarity_code: Mapped[Optional[str]] = mapped_column(String(), nullable=True)
    language: Mapped[str] = mapped_column(String(), nullable=False)
    language_code: Mapped[str] = mapped_column(String(5), nullable=False)
    expansion_sort_order: Mapped[Optional[int]] = mapped_column(Integer(), nullable=True)
    images: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB(), nullable=True)
    variants: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(JSONB(), nullable=True)
    price_data_uploaded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(), nullable=True)
    last_synced_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False)

    # Pokemon-only fields
    supertype: Mapped[Optional[str]] = mapped_column(String(), nullable=True)
    subtypes: Mapped[Optional[List[str]]] = mapped_column(JSONB(), nullable=True)
    types: Mapped[Optional[List[str]]] = mapped_column(JSONB(), nullable=True)
    hp: Mapped[Optional[str]] = mapped_column(String(), nullable=True)
    level: Mapped[Optional[str]] = mapped_column(String(), nullable=True)
    evolves_from: Mapped[Optional[Any]] = mapped_column(JSONB(), nullable=True)
    abilities: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(JSONB(), nullable=True)
    attacks: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(JSONB(), nullable=True)
    weaknesses: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(JSONB(), nullable=True)
    resistances: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(JSONB(), nullable=True)
    retreat_cost: Mapped[Optional[List[str]]] = mapped_column(JSONB(), nullable=True)
    national_pokedex_numbers: Mapped[Optional[List[int]]] = mapped_column(JSONB(), nullable=True)
    flavor_text: Mapped[Optional[str]] = mapped_column(Text(), nullable=True)
    regulation_mark: Mapped[Optional[str]] = mapped_column(String(), nullable=True)
    artist: Mapped[Optional[str]] = mapped_column(String(), nullable=True)

    # One Piece-only fields
    cost: Mapped[Optional[str]] = mapped_column(String(), nullable=True)
    power: Mapped[Optional[str]] = mapped_column(String(), nullable=True)
    attribute: Mapped[Optional[str]] = mapped_column(String(), nullable=True)
    card_type: Mapped[Optional[str]] = mapped_column(String(), nullable=True)
    colors: Mapped[Optional[List[str]]] = mapped_column(JSONB(), nullable=True)
    rules: Mapped[Optional[List[str]]] = mapped_column(JSONB(), nullable=True)
    printings: Mapped[Optional[List[str]]] = mapped_column(JSONB(), nullable=True)
    tags: Mapped[Optional[List[str]]] = mapped_column(JSONB(), nullable=True)

    expansion: Mapped["ExpansionV2"] = relationship("ExpansionV2", back_populates="cards")
