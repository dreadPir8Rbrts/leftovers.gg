"""
Profile endpoints — onboarding and profile management.

Routes:
  GET   /profiles/me                      — get own profile (authenticated)
  PATCH /profiles/me                      — update own profile
  POST  /profiles/me/background           — upload background image to S3
  POST  /profiles/me/avatar               — upload avatar image to S3
  GET   /profiles/{profile_id}            — public profile (no auth required; is_public must be true)
  GET   /profiles/{profile_id}/inventory  — public inventory for a profile (active for-sale/trade items)
"""

import uuid as uuid_module
from decimal import Decimal
from typing import Optional, List, Dict, Any

import boto3
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from pydantic import BaseModel, Field
from sqlalchemy import cast
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Session

from app.db.session import get_db, settings
from app.dependencies import get_current_profile
from app.models.catalog_v2 import CardV2, ExpansionV2
from app.models.collector import Wishlist
from app.models.inventory import Inventory
from app.models.profiles import Profile

router = APIRouter(tags=["profiles"])

_VALID_ROLES = {"vendor", "collector"}


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = Field(None, min_length=1, max_length=50)
    role: Optional[str] = None
    bio: Optional[str] = None
    tcg_interests: Optional[List[str]] = None
    zip_code: Optional[str] = Field(None, pattern=r"^\d{5}$")
    avatar_url: Optional[str] = None
    onboarding_complete: Optional[bool] = None
    buying_rate: Optional[Decimal] = Field(None, ge=0, le=1)
    trade_rate: Optional[Decimal] = Field(None, ge=0, le=1)
    is_accounting_enabled: Optional[bool] = None


def _public_profile_response(profile: Profile) -> Dict[str, Any]:
    """Safe subset of profile fields — returned to unauthenticated visitors."""
    return {
        "id": profile.id,
        "role": profile.role,
        "display_name": profile.display_name,
        "bio": profile.bio,
        "tcg_interests": profile.tcg_interests,
        "avatar_url": profile.avatar_url,
        "background_url": profile.background_url,
        "buying_rate": profile.buying_rate,
        "trade_rate": profile.trade_rate,
        "is_public": profile.is_public,
    }


def _inventory_item_response(inv: Inventory, card: Optional[CardV2], expansion: Optional[ExpansionV2]) -> Dict[str, Any]:
    def _image_url(images: Any) -> Optional[str]:
        if not images or not isinstance(images, list):
            return None
        return images[0].get("small") or images[0].get("large")

    return {
        "id": inv.id,
        "card_v2_id": inv.card_v2_id,
        "card_name": card.name if card else None,
        "set_name": expansion.name if expansion else None,
        "series_name": expansion.series if expansion else None,
        "card_num": card.number if card else None,
        "rarity": card.rarity if card else None,
        "image_url": _image_url(card.images) if card else None,
        "condition_type": inv.condition_type,
        "condition_ungraded": inv.condition_ungraded,
        "grading_company": inv.grading_company,
        "grade": inv.grade,
        "grading_company_other": inv.grading_company_other,
        "quantity": inv.quantity,
        "asking_price": float(inv.asking_price) if inv.asking_price is not None else None,
        "is_for_sale": inv.is_for_sale,
        "is_for_trade": inv.is_for_trade,
        "notes": inv.notes,
        "photo_url": inv.photo_url,
    }


def _profile_response(profile: Profile) -> Dict[str, Any]:
    return {
        "id": profile.id,
        "role": profile.role,
        "display_name": profile.display_name,
        "bio": profile.bio,
        "tcg_interests": profile.tcg_interests,
        "onboarding_complete": profile.onboarding_complete,
        "zip_code": profile.zip_code,
        "avatar_url": profile.avatar_url,
        "background_url": profile.background_url,
        "buying_rate": profile.buying_rate,
        "trade_rate": profile.trade_rate,
        "is_accounting_enabled": profile.is_accounting_enabled,
    }


@router.get("/profiles/me")
def get_profile(
    profile: Profile = Depends(get_current_profile),
) -> Dict[str, Any]:
    """Return the authenticated user's profile."""
    return _profile_response(profile)


@router.get("/profiles/me/wishlist")
def get_own_wishlist(
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """Return the authenticated user's wishlist with card details."""
    rows = (
        db.query(Wishlist, CardV2, ExpansionV2)
        .outerjoin(CardV2, CardV2.id == cast(Wishlist.card_id, PGUUID(as_uuid=True)))
        .outerjoin(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
        .filter(Wishlist.profile_id == profile.id)
        .order_by(Wishlist.created_at.desc())
        .all()
    )
    return [_wishlist_item_response(item, card, expansion) for item, card, expansion in rows]


@router.patch("/profiles/me")
def update_profile(
    body: ProfileUpdate,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Update the authenticated user's profile."""
    update_data = body.model_dump(exclude_none=True)
    if not update_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    if "role" in update_data and update_data["role"] not in _VALID_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Must be one of: {', '.join(sorted(_VALID_ROLES))}",
        )

    for key, value in update_data.items():
        setattr(profile, key, value)

    db.add(profile)
    db.commit()
    db.refresh(profile)
    return _profile_response(profile)


@router.post("/profiles/me/background")
def upload_background(
    image: UploadFile = File(...),
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> Dict[str, str]:
    """Upload background image to S3, persist URL to profiles.background_url, return it."""
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File must be an image")

    image_bytes = image.file.read()
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Background image must be under 10 MB")

    if not settings.aws_s3_bucket:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Image storage not configured",
        )

    s3 = boto3.client(
        "s3",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
    )
    key = f"backgrounds/{profile.id}/{uuid_module.uuid4()}.jpg"
    s3.put_object(
        Bucket=settings.aws_s3_bucket,
        Key=key,
        Body=image_bytes,
        ContentType=image.content_type,
    )
    url = f"https://{settings.aws_s3_bucket}.s3.amazonaws.com/{key}"
    profile.background_url = url
    db.add(profile)
    db.commit()
    return {"background_url": url}


@router.post("/profiles/me/avatar")
def upload_avatar(
    image: UploadFile = File(...),
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> Dict[str, str]:
    """Upload avatar image to S3 and return the public URL."""
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File must be an image")

    image_bytes = image.file.read()
    if len(image_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Avatar must be under 5 MB")

    if not settings.aws_s3_bucket:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Avatar storage not configured",
        )

    s3 = boto3.client(
        "s3",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
    )
    key = f"avatars/{profile.id}/{uuid_module.uuid4()}.jpg"
    s3.put_object(
        Bucket=settings.aws_s3_bucket,
        Key=key,
        Body=image_bytes,
        ContentType=image.content_type,
    )
    url = f"https://{settings.aws_s3_bucket}.s3.amazonaws.com/{key}"
    profile.avatar_url = url
    db.add(profile)
    db.commit()
    return {"avatar_url": url}


# ---------------------------------------------------------------------------
# Public profile endpoints (no auth required)
# NOTE: these routes must be declared AFTER /profiles/me to avoid shadowing it.
# ---------------------------------------------------------------------------

@router.get("/profiles/{profile_id}")
def get_public_profile(
    profile_id: str,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Return a public profile. Returns 404 if not found or is_public=False."""
    profile = db.get(Profile, profile_id)
    if profile is None or not profile.is_public:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")
    return _public_profile_response(profile)


@router.get("/profiles/{profile_id}/inventory")
def get_public_profile_inventory(
    profile_id: str,
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """Return active for-sale/for-trade inventory for a public profile."""
    profile = db.get(Profile, profile_id)
    if profile is None or not profile.is_public:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")

    rows = (
        db.query(Inventory, CardV2, ExpansionV2)
        .outerjoin(CardV2, Inventory.card_v2_id == CardV2.id)
        .outerjoin(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
        .filter(
            Inventory.profile_id == profile_id,
            Inventory.status == "active",
            Inventory.deleted_at.is_(None),
            (Inventory.is_for_sale.is_(True)) | (Inventory.is_for_trade.is_(True)),
        )
        .all()
    )

    return [_inventory_item_response(inv, card, expansion) for inv, card, expansion in rows]


@router.get("/profiles/{profile_id}/wishlist")
def get_public_profile_wishlist(
    profile_id: str,
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """Return wishlist for a public profile, including card details and conditions."""
    profile = db.get(Profile, profile_id)
    if profile is None or not profile.is_public:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")

    rows = (
        db.query(Wishlist, CardV2, ExpansionV2)
        .outerjoin(CardV2, CardV2.id == cast(Wishlist.card_id, PGUUID(as_uuid=True)))
        .outerjoin(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
        .filter(Wishlist.profile_id == profile_id)
        .order_by(Wishlist.created_at.desc())
        .all()
    )

    return [_wishlist_item_response(item, card, expansion) for item, card, expansion in rows]


def _wishlist_item_response(
    item: Wishlist,
    card: Optional[CardV2],
    expansion: Optional[ExpansionV2],
) -> Dict[str, Any]:
    return {
        "id": item.id,
        "card_id": item.card_id,
        "card_name": card.name if card else None,
        "card_name_en": card.en_name if card else None,
        "set_name": expansion.name if expansion else None,
        "set_name_en": expansion.name_en if expansion else None,
        "card_num": card.printed_number if card else None,
        "rarity": card.rarity if card else None,
        "image_url": _image_url(card.images) if card else None,
        "language_code": card.language_code if card else None,
        "max_price": float(item.max_price) if item.max_price is not None else None,
        "notes": item.notes,
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
        "created_at": item.created_at.isoformat(),
    }
