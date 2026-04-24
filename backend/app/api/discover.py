"""
Discovery endpoints — find users by card or username.

Routes (public — no auth required):
  GET /discover/card/{card_id}/sellers  — profiles with this card for sale/trade
  GET /discover/card/{card_id}/wanted   — profiles with this card on their wishlist
  GET /discover/users?q=               — search public profiles by display_name
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.collector import Wishlist
from app.models.inventory import Inventory
from app.models.profiles import Profile

router = APIRouter(tags=["discover"])


def _image_url(images: Any) -> Optional[str]:
    if not images or not isinstance(images, list):
        return None
    return images[0].get("small") or images[0].get("large")


def _profile_stub(profile: Profile) -> Dict[str, Any]:
    return {
        "profile_id": profile.id,
        "display_name": profile.display_name,
        "avatar_url": profile.avatar_url,
        "buying_rate": float(profile.buying_rate) if profile.buying_rate is not None else None,
        "trade_rate": float(profile.trade_rate) if profile.trade_rate is not None else None,
    }


@router.get("/discover/card/{card_id}/sellers")
def get_card_sellers(
    card_id: str,
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """Return all public profiles that have this card actively for sale or trade."""
    rows = (
        db.query(Inventory, Profile)
        .join(Profile, Inventory.profile_id == Profile.id)
        .filter(
            Inventory.card_v2_id == card_id,
            Inventory.status == "active",
            Inventory.deleted_at.is_(None),
            (Inventory.is_for_sale.is_(True)) | (Inventory.is_for_trade.is_(True)),
            Profile.is_public.is_(True),
        )
        .order_by(Inventory.asking_price.asc().nulls_last())
        .limit(50)
        .all()
    )
    return [
        {
            **_profile_stub(profile),
            "inventory_id": inv.id,
            "condition_type": inv.condition_type,
            "condition_ungraded": inv.condition_ungraded,
            "grading_company": inv.grading_company,
            "grade": inv.grade,
            "grading_company_other": inv.grading_company_other,
            "asking_price": float(inv.asking_price) if inv.asking_price is not None else None,
            "is_for_sale": inv.is_for_sale,
            "is_for_trade": inv.is_for_trade,
            "quantity": inv.quantity,
            "notes": inv.notes,
            "photo_url": inv.photo_url,
        }
        for inv, profile in rows
    ]


@router.get("/discover/card/{card_id}/wanted")
def get_card_wanted(
    card_id: str,
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """Return all public profiles that have this card on their wishlist."""
    rows = (
        db.query(Wishlist, Profile)
        .join(Profile, Wishlist.profile_id == Profile.id)
        .filter(
            Wishlist.card_id == card_id,
            Profile.is_public.is_(True),
        )
        .order_by(Wishlist.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        {
            **_profile_stub(profile),
            "wishlist_item_id": item.id,
            "conditions": [
                {
                    "id": c.id,
                    "condition_type": c.condition_type,
                    "condition_ungraded": c.condition_ungraded,
                    "grading_company": c.grading_company,
                    "grading_company_other": c.grading_company_other,
                    "grade": c.grade,
                }
                for c in item.conditions
            ],
            "max_price": float(item.max_price) if item.max_price is not None else None,
            "notes": item.notes,
        }
        for item, profile in rows
    ]


@router.get("/discover/users")
def search_users(
    q: str = Query(..., min_length=1, max_length=100),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """Search public profiles by display_name (case-insensitive substring match)."""
    profiles = (
        db.query(Profile)
        .filter(
            Profile.is_public.is_(True),
            Profile.display_name.ilike(f"%{q}%"),
        )
        .order_by(Profile.display_name.asc())
        .limit(20)
        .all()
    )
    return [
        {
            "id": p.id,
            "display_name": p.display_name,
            "avatar_url": p.avatar_url,
            "role": p.role,
            "bio": p.bio,
            "tcg_interests": p.tcg_interests,
            "buying_rate": float(p.buying_rate) if p.buying_rate is not None else None,
            "trade_rate": float(p.trade_rate) if p.trade_rate is not None else None,
        }
        for p in profiles
    ]
