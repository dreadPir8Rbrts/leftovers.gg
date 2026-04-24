"""
Collector endpoints.

Routes:
  POST   /wishlist                    — add card to wishlist (authenticated)
  GET    /wishlist                    — list own wishlist (authenticated)
  DELETE /wishlist/{id}               — remove wishlist item (authenticated)
  PUT    /wishlist/{id}/conditions    — replace all conditions on a wishlist item
"""

import uuid
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies import get_current_profile
from app.models.collector import Wishlist, WishlistCondition
from app.models.profiles import Profile

router = APIRouter(tags=["wishlist"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class WishlistConditionIn(BaseModel):
    condition_type: str = Field(..., pattern="^(ungraded|graded)$")
    condition_ungraded: Optional[str] = None
    grading_company: Optional[str] = None
    grading_company_other: Optional[str] = None
    grade: Optional[str] = None


class WishlistConditionOut(BaseModel):
    id: str
    condition_type: str
    condition_ungraded: Optional[str]
    grading_company: Optional[str]
    grading_company_other: Optional[str]
    grade: Optional[str]

    model_config = {"from_attributes": True}


class WishlistItemCreate(BaseModel):
    card_id: str
    max_price: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None
    conditions: List[WishlistConditionIn] = Field(default_factory=list)


class WishlistItemResponse(BaseModel):
    id: str
    card_id: str
    max_price: Optional[float]
    notes: Optional[str]
    conditions: List[WishlistConditionOut]
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_conditions(wishlist_item_id: str, conditions: List[WishlistConditionIn]) -> List[WishlistCondition]:
    return [
        WishlistCondition(
            id=str(uuid.uuid4()),
            wishlist_item_id=wishlist_item_id,
            condition_type=c.condition_type,
            condition_ungraded=c.condition_ungraded,
            grading_company=c.grading_company,
            grading_company_other=c.grading_company_other,
            grade=c.grade,
        )
        for c in conditions
    ]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/wishlist", response_model=WishlistItemResponse, status_code=status.HTTP_201_CREATED)
def add_to_wishlist(
    body: WishlistItemCreate,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> Wishlist:
    item_id = str(uuid.uuid4())
    item = Wishlist(
        id=item_id,
        profile_id=profile.id,
        card_id=body.card_id,
        max_price=body.max_price,
        notes=body.notes,
        conditions=_build_conditions(item_id, body.conditions),
    )
    db.add(item)
    try:
        db.commit()
        db.refresh(item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Card is already in your wishlist",
        )
    return item


@router.get("/wishlist", response_model=List[WishlistItemResponse])
def get_wishlist(
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> List[Wishlist]:
    return (
        db.query(Wishlist)
        .filter(Wishlist.profile_id == profile.id)
        .order_by(Wishlist.created_at.desc())
        .all()
    )


@router.delete("/wishlist/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_from_wishlist(
    item_id: str,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> None:
    item = (
        db.query(Wishlist)
        .filter(Wishlist.id == item_id, Wishlist.profile_id == profile.id)
        .first()
    )
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wishlist item not found")
    db.delete(item)
    db.commit()


@router.put("/wishlist/{item_id}/conditions", response_model=WishlistItemResponse)
def update_wishlist_conditions(
    item_id: str,
    body: List[WishlistConditionIn],
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> Wishlist:
    item = (
        db.query(Wishlist)
        .filter(Wishlist.id == item_id, Wishlist.profile_id == profile.id)
        .first()
    )
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wishlist item not found")

    # Replace all existing conditions
    for c in list(item.conditions):
        db.delete(c)
    db.flush()

    item.conditions = _build_conditions(item_id, body)
    db.commit()
    db.refresh(item)
    return item
