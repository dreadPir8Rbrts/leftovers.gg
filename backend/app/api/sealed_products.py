"""Sealed products catalog endpoints."""

from datetime import date
from typing import Optional, List

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from app.db.session import get_db
from app.dependencies import get_current_profile
from app.models.profiles import Profile
from app.models.sealed_product import SealedProduct

router = APIRouter(tags=["sealed-products"])


class SealedProductOut(BaseModel):
    id: str
    name: str
    game: str
    language_code: str
    product_type: str
    expansion_id: Optional[str] = None
    release_date: Optional[date] = None
    image_url: Optional[str] = None

    model_config = {"from_attributes": True}


@router.get("/sealed-products/search", response_model=List[SealedProductOut])
def search_sealed_products(
    q: Optional[str] = Query(None),
    game: Optional[str] = Query(None),
    language_code: Optional[str] = Query(None),
    product_type: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    _profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> List[dict]:
    query = db.query(SealedProduct).filter(SealedProduct.is_active.is_(True))

    if q:
        term = f"%{q.lower()}%"
        query = query.filter(func.lower(SealedProduct.name).like(term))

    if game:
        query = query.filter(SealedProduct.game == game)
    if language_code:
        query = query.filter(SealedProduct.language_code == language_code)
    if product_type:
        query = query.filter(SealedProduct.product_type == product_type)

    results = query.order_by(SealedProduct.name).limit(limit).all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "game": r.game,
            "language_code": r.language_code,
            "product_type": r.product_type,
            "expansion_id": r.expansion_id,
            "release_date": r.release_date,
            "image_url": r.image_url,
        }
        for r in results
    ]
