"""
Collector endpoints.

Routes:
  POST   /wishlist          — add card to wishlist (authenticated)
  GET    /wishlist          — list own wishlist (authenticated)
  DELETE /wishlist/{id}     — remove wishlist item (authenticated)
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
from app.models.collector import Wishlist
from app.models.profiles import Profile

router = APIRouter(tags=["wishlist"])


class WishlistItemCreate(BaseModel):
    card_id: str
    max_price: Optional[float] = Field(None, ge=0)
    desired_condition: Optional[str] = None
    notes: Optional[str] = None


class WishlistItemResponse(BaseModel):
    id: str
    card_id: str
    max_price: Optional[float]
    desired_condition: Optional[str]
    notes: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


@router.post("/wishlist", response_model=WishlistItemResponse, status_code=status.HTTP_201_CREATED)
def add_to_wishlist(
    body: WishlistItemCreate,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> Wishlist:
    item = Wishlist(
        id=str(uuid.uuid4()),
        profile_id=profile.id,
        card_id=body.card_id,
        max_price=body.max_price,
        desired_condition=body.desired_condition,
        notes=body.notes,
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
