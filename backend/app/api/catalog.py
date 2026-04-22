"""
Catalog endpoints — served from cards_v2 + expansions_v2 (V2 API sourced data).

Routes:
  GET /cards          — search cards by name, game, language, expansion
  GET /cards/{id}     — card detail by UUID
  GET /expansions     — list expansions, optionally filtered by game/language
  GET /expansions/{id} — expansion detail with local card count
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.catalog_v2 import CardV2, ExpansionV2

router = APIRouter(tags=["catalog"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_LANG_MAP = {
    "en": "EN", "english": "EN",
    "ja": "JA", "japanese": "JA",
}

def _normalize_lang(code: str) -> str:
    return _LANG_MAP.get(code.lower(), code.upper())


def _extract_image_url(images: Optional[list]) -> Optional[str]:
    """Pull the small image URL from the V2 API images array (suitable for thumbnails)."""
    if not images:
        return None
    if isinstance(images, list) and images:
        return images[0].get("small") or images[0].get("large")
    return None


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class CardDetailResponse(BaseModel):
    id: str
    card_num: Optional[str] = None
    name: str
    en_name: Optional[str] = None
    rarity: Optional[str] = None
    image_url: Optional[str] = None
    set_name: str
    set_name_en: Optional[str] = None
    release_date: Optional[str] = None
    series_name: Optional[str] = None   # None for One Piece
    game: str
    language_code: str

    model_config = {"from_attributes": True}


class ExpansionResponse(BaseModel):
    id: str
    external_id: str
    game: str
    name: str
    series: Optional[str] = None
    total: Optional[int] = None
    language: str
    language_code: str
    release_date: Optional[str] = None
    logo_url: Optional[str] = None

    model_config = {"from_attributes": True}


def _build_card_response(card: CardV2, expansion: ExpansionV2) -> dict:
    return {
        "id": str(card.id),
        "card_num": card.number,
        "name": card.name,
        "en_name": card.en_name,
        "rarity": card.rarity,
        "image_url": _extract_image_url(card.images),
        "set_name": expansion.name,
        "set_name_en": expansion.translation,
        "release_date": str(expansion.release_date) if expansion.release_date else None,
        "series_name": expansion.series,
        "game": card.game,
        "language_code": card.language_code,
    }


def _build_expansion_response(expansion: ExpansionV2) -> dict:
    return {
        "id": str(expansion.id),
        "external_id": expansion.external_id,
        "game": expansion.game,
        "name": expansion.name,
        "series": expansion.series,
        "total": expansion.total,
        "language": expansion.language,
        "language_code": expansion.language_code,
        "release_date": str(expansion.release_date) if expansion.release_date else None,
        "logo_url": expansion.logo_url,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/cards/search", response_model=List[CardDetailResponse])
def smart_search_cards(
    q: Optional[str] = Query(None, min_length=2, description="Free-text: each word matched against card name or expansion name"),
    card_num: Optional[str] = Query(None, description="Card number — supports leading zeros and printed format (e.g. 034, 170/165)"),
    language_code: Optional[str] = Query(None, description="Language code e.g. en, ja"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Smart search: each token in q must appear in card name OR expansion name.

    Designed for free-text inventory lookups like 'jolteon prismatic' or
    'charizard ex scarlet violet'. card_num is extracted separately so
    'squirtle 170 ja' becomes q=squirtle, card_num=170, language_code=ja.
    """
    if not any([q, card_num]):
        raise HTTPException(status_code=422, detail="At least one of q or card_num is required.")

    query = (
        db.query(CardV2, ExpansionV2)
        .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
    )

    if q:
        for word in q.strip().split():
            query = query.filter(
                or_(
                    CardV2.name.ilike(f"%{word}%"),
                    CardV2.en_name.ilike(f"%{word}%"),
                    ExpansionV2.name.ilike(f"%{word}%"),
                    ExpansionV2.name_en.ilike(f"%{word}%"),
                    ExpansionV2.translation.ilike(f"%{word}%"),
                )
            )

    if card_num:
        if "/" in card_num:
            parts = card_num.split("/", 1)
            num_part = parts[0].lstrip("0") or "0"
            try:
                total_int = int(parts[1].strip())
                query = query.filter(
                    or_(
                        CardV2.printed_number == card_num,
                        and_(
                            CardV2.number == num_part,
                            ExpansionV2.printed_total == total_int,
                        ),
                    )
                )
            except ValueError:
                num_stripped = card_num.lstrip("0") or card_num
                query = query.filter(
                    or_(
                        CardV2.number.ilike(f"%{num_stripped}%"),
                        CardV2.printed_number.ilike(f"%{card_num}%"),
                    )
                )
        else:
            num_stripped = card_num.lstrip("0") or card_num
            query = query.filter(
                or_(
                    CardV2.number.ilike(f"%{num_stripped}%"),
                    CardV2.printed_number.ilike(f"%{card_num}%"),
                )
            )

    if language_code:
        query = query.filter(CardV2.language_code == _normalize_lang(language_code))

    rows = query.order_by(CardV2.name).offset(offset).limit(limit).all()
    return [_build_card_response(card, expansion) for card, expansion in rows]


@router.get("/cards/{card_id}", response_model=CardDetailResponse)
def get_card(card_id: str, db: Session = Depends(get_db)):
    row = (
        db.query(CardV2, ExpansionV2)
        .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
        .filter(CardV2.id == card_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Card not found")
    card, expansion = row
    return _build_card_response(card, expansion)


@router.get("/cards", response_model=List[CardDetailResponse])
def search_cards(
    name: Optional[str] = Query(None, min_length=2, description="Filter by card name (contains)"),
    card_num: Optional[str] = Query(None, min_length=1, description="Filter by card number within set"),
    game: Optional[str] = Query(None, description="Filter by game: pokemon | onepiece"),
    language_code: Optional[str] = Query(None, description="Filter by language code e.g. en, ja"),
    set_name: Optional[str] = Query(None, min_length=2, description="Filter by expansion name (contains)"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    if not any([name, card_num, set_name]):
        raise HTTPException(status_code=422, detail="At least one of name, card_num, or set_name is required.")

    query = (
        db.query(CardV2, ExpansionV2)
        .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
    )
    if name:
        query = query.filter(CardV2.name.ilike(f"%{name}%"))
    if card_num:
        if "/" in card_num:
            parts = card_num.split("/", 1)
            num_part = parts[0].lstrip("0") or "0"
            total_str = parts[1].strip()
            try:
                total_int = int(total_str)
                query = query.filter(
                    or_(
                        CardV2.printed_number == card_num,
                        and_(
                            CardV2.number == num_part,
                            ExpansionV2.printed_total == total_int,
                        ),
                    )
                )
            except ValueError:
                query = query.filter(CardV2.number.ilike(f"%{card_num}%"))
        else:
            num_stripped = card_num.lstrip("0") or card_num
            query = query.filter(
                or_(
                    CardV2.number.ilike(f"%{num_stripped}%"),
                    CardV2.printed_number.ilike(f"%{card_num}%"),
                )
            )
    if game:
        query = query.filter(CardV2.game == game)
    if language_code:
        query = query.filter(CardV2.language_code == _normalize_lang(language_code))
    if set_name:
        query = query.filter(ExpansionV2.name.ilike(f"%{set_name}%"))

    rows = query.order_by(CardV2.name).offset(offset).limit(limit).all()
    return [_build_card_response(card, expansion) for card, expansion in rows]


@router.get("/expansions/{expansion_id}", response_model=ExpansionResponse)
def get_expansion(expansion_id: str, db: Session = Depends(get_db)):
    from sqlalchemy import func
    expansion = db.get(ExpansionV2, expansion_id)
    if expansion is None:
        raise HTTPException(status_code=404, detail="Expansion not found")
    return _build_expansion_response(expansion)


@router.get("/expansions", response_model=List[ExpansionResponse])
def list_expansions(
    game: Optional[str] = Query(None, description="Filter by game: pokemon | onepiece"),
    language_code: Optional[str] = Query(None, description="Filter by language code e.g. en, ja"),
    db: Session = Depends(get_db),
):
    query = db.query(ExpansionV2)
    if game:
        query = query.filter(ExpansionV2.game == game)
    if language_code:
        query = query.filter(ExpansionV2.language_code == language_code)
    rows = query.order_by(ExpansionV2.release_date.desc().nullslast()).all()
    return [_build_expansion_response(e) for e in rows]
