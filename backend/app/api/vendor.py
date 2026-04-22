"""
Inventory endpoints.

Routes:
  POST /inventory            — add inventory item (authenticated)
  GET  /inventory            — list own inventory with filters (authenticated)
  POST /vendor/profile/image — generate presigned S3 URL for profile image upload
"""

import uuid
from datetime import datetime, timedelta
from typing import Optional, List, Dict

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session

from app.db.session import get_db, settings
from app.dependencies import get_current_profile
from app.models.catalog import SoldComp
from app.models.excluded_sold_comps import ExcludedSoldComp
from app.models.inventory import Inventory
from app.models.profiles import Profile
from app.models.catalog_v2 import CardV2, ExpansionV2
from app.schemas.vendor import (
    InventoryItemCreate,
    InventoryItemPatch,
    InventoryItemResponse,
    InventoryItemWithCardResponse,
)
from app.api.pricing import (
    _aggregate_prices,
    _enqueue_ebay_on_demand,
    _get_or_create_preferences,
)

router = APIRouter(tags=["inventory"])

PROFILE_IMAGE_TYPES = {"background", "avatar"}
PRESIGNED_URL_EXPIRY = 300  # seconds


class ProfileImageUploadRequest(BaseModel):
    image_type: str   # "background" or "avatar"
    content_type: str = "image/jpeg"


class ProfileImageUploadResponse(BaseModel):
    upload_url: str
    public_url: str


# ---------------------------------------------------------------------------
# Profile image upload (presigned S3 URL)
# ---------------------------------------------------------------------------

@router.post("/vendor/profile/image", response_model=ProfileImageUploadResponse)
def get_profile_image_upload_url(
    body: ProfileImageUploadRequest,
    profile: Profile = Depends(get_current_profile),
) -> dict:
    """
    Generate a presigned S3 PUT URL for uploading a profile background or avatar image.
    The client uploads directly to S3, then calls PATCH /profiles/me with the public_url.
    """
    if body.image_type not in PROFILE_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"image_type must be one of {PROFILE_IMAGE_TYPES}",
        )

    ext = body.content_type.split("/")[-1] if "/" in body.content_type else "jpg"
    s3_key = f"profiles/{profile.id}/{body.image_type}.{ext}"

    s3 = boto3.client(
        "s3",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        config=Config(signature_version="s3v4"),
    )
    try:
        upload_url = s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": settings.aws_s3_bucket,
                "Key": s3_key,
                "ContentType": body.content_type,
            },
            ExpiresIn=PRESIGNED_URL_EXPIRY,
        )
    except ClientError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate upload URL",
        ) from exc

    public_url = f"https://{settings.aws_s3_bucket}.s3.{settings.aws_region}.amazonaws.com/{s3_key}"
    return {"upload_url": upload_url, "public_url": public_url}


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------

@router.post("/inventory", response_model=InventoryItemResponse, status_code=status.HTTP_201_CREATED)
def add_inventory_item(
    body: InventoryItemCreate,
    background_tasks: BackgroundTasks,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> dict:
    card = db.get(CardV2, body.card_id)
    if card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Card '{body.card_id}' not found")

    item = Inventory(
        id=str(uuid.uuid4()),
        profile_id=profile.id,
        card_v2_id=body.card_id,
        condition_type=body.condition_type,
        condition_ungraded=body.condition_ungraded,
        grading_company=body.grading_company,
        grade=body.grade,
        grading_company_other=body.grading_company_other,
        quantity=body.quantity,
        acquired_price=body.acquired_price,
        asking_price=body.asking_price,
        is_for_sale=body.is_for_sale,
        is_for_trade=body.is_for_trade,
        notes=body.notes,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    if body.condition_type == "graded":
        background_tasks.add_task(
            _enqueue_ebay_on_demand,
            item.card_v2_id,
            body.grading_company,
            body.grade,
            "graded",
        )

    return {
        "id": item.id,
        "profile_id": item.profile_id,
        "card_id": item.card_v2_id,
        "condition_type": item.condition_type,
        "condition_ungraded": item.condition_ungraded,
        "grading_company": item.grading_company,
        "grade": item.grade,
        "grading_company_other": item.grading_company_other,
        "quantity": item.quantity,
        "acquired_price": item.acquired_price,
        "asking_price": item.asking_price,
        "is_for_sale": item.is_for_sale,
        "is_for_trade": item.is_for_trade,
        "notes": item.notes,
        "photo_url": item.photo_url,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


@router.get("/inventory", response_model=List[InventoryItemWithCardResponse])
def list_inventory(
    condition_type: Optional[str] = Query(None),
    card_id: Optional[str] = Query(None),
    is_for_sale: Optional[bool] = Query(None),
    is_for_trade: Optional[bool] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> List[dict]:
    query = (
        db.query(Inventory, CardV2, ExpansionV2)
        .join(CardV2, Inventory.card_v2_id == CardV2.id)
        .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
        .filter(
            Inventory.profile_id == profile.id,
            Inventory.deleted_at.is_(None),
        )
    )

    if condition_type:
        query = query.filter(Inventory.condition_type == condition_type)
    if card_id:
        query = query.filter(Inventory.card_v2_id == card_id)
    if is_for_sale is not None:
        query = query.filter(Inventory.is_for_sale == is_for_sale)
    if is_for_trade is not None:
        query = query.filter(Inventory.is_for_trade == is_for_trade)

    rows = query.order_by(Inventory.created_at.desc()).offset(offset).limit(limit).all()

    # Build estimated_value for graded items using stored sold comps + user preferences.
    prefs = _get_or_create_preferences(db, profile.id)

    comp_map: Dict[tuple, List[SoldComp]] = {}
    graded_combos = {
        (item.card_v2_id, item.grading_company, item.grade)
        for item, _, _ in rows
        if item.condition_type == "graded" and item.grading_company and item.grade
    }

    if graded_combos:
        excluded_ids = {
            row.sold_comp_id
            for row in db.query(ExcludedSoldComp)
            .filter(ExcludedSoldComp.profile_id == profile.id)
            .all()
        }
        sold_cutoff = datetime.utcnow() - timedelta(days=prefs.graded_comp_window_days)
        fetch_cutoff = datetime.utcnow() - timedelta(days=90)
        conditions = or_(*[
            and_(
                SoldComp.card_v2_id == card_v2_id,
                SoldComp.grading_company == gc,
                SoldComp.grade == gr,
            )
            for card_v2_id, gc, gr in graded_combos
        ])
        all_comps = (
            db.query(SoldComp)
            .filter(
                conditions,
                SoldComp.condition_type == "graded",
                SoldComp.sold_date >= sold_cutoff,
                SoldComp.price.isnot(None),
                SoldComp.fetched_at >= fetch_cutoff,
            )
            .order_by(SoldComp.sold_date.desc().nullslast())
            .all()
        )
        for comp in all_comps:
            if comp.id in excluded_ids:
                continue
            key = (str(comp.card_v2_id), comp.grading_company, comp.grade)
            comp_map.setdefault(key, []).append(comp)

    now = datetime.utcnow()

    result = []
    for item, card, expansion in rows:
        estimated_value = None
        if item.condition_type == "graded" and item.grading_company and item.grade:
            comps = comp_map.get((str(item.card_v2_id), item.grading_company, item.grade), [])
            if comps:
                prices = [float(c.price) for c in comps]
                days_ago = [(now - c.sold_date).days if c.sold_date else 0.0 for c in comps]
                estimated_value = _aggregate_prices(
                    prices,
                    prefs.graded_aggregation,
                    iqr_multiplier=float(prefs.graded_iqr_multiplier),
                    halflife_days=prefs.graded_recency_halflife_days,
                    trim_pct=float(prefs.graded_trim_pct),
                    days_ago=days_ago,
                )
        result.append({
            "id": item.id,
            "card_id": str(item.card_v2_id),
            "condition_type": item.condition_type,
            "condition_ungraded": item.condition_ungraded,
            "grading_company": item.grading_company,
            "grade": item.grade,
            "grading_company_other": item.grading_company_other,
            "quantity": item.quantity,
            "acquired_price": item.acquired_price,
            "asking_price": item.asking_price,
            "is_for_sale": item.is_for_sale,
            "is_for_trade": item.is_for_trade,
            "notes": item.notes,
            "created_at": item.created_at,
            "estimated_value": estimated_value,
            "card_name": card.name,
            "card_name_en": card.en_name,
            "card_num": card.number,
            "set_name": expansion.name,
            "set_name_en": expansion.translation,
            "series_name": expansion.series,
            "image_url": _extract_image_url(card.images),
            "rarity": card.rarity,
            "game": card.game,
            "language_code": card.language_code,
        })
    return result


@router.patch("/inventory/{item_id}", response_model=InventoryItemResponse)
def patch_inventory_item(
    item_id: str,
    body: InventoryItemPatch,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> dict:
    """Update mutable fields on an existing inventory item (acquired_price, asking_price, notes)."""
    item = db.query(Inventory).filter(
        Inventory.id == item_id,
        Inventory.profile_id == profile.id,
        Inventory.deleted_at.is_(None),
    ).first()
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found")

    if body.acquired_price is not None:
        item.acquired_price = body.acquired_price
    if body.asking_price is not None:
        item.asking_price = body.asking_price
    if body.is_for_sale is not None:
        item.is_for_sale = body.is_for_sale
    if body.is_for_trade is not None:
        item.is_for_trade = body.is_for_trade
    if body.notes is not None:
        item.notes = body.notes

    item.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(item)
    return {
        "id": item.id,
        "profile_id": item.profile_id,
        "card_id": item.card_v2_id,
        "condition_type": item.condition_type,
        "condition_ungraded": item.condition_ungraded,
        "grading_company": item.grading_company,
        "grade": item.grade,
        "grading_company_other": item.grading_company_other,
        "quantity": item.quantity,
        "acquired_price": item.acquired_price,
        "asking_price": item.asking_price,
        "is_for_sale": item.is_for_sale,
        "is_for_trade": item.is_for_trade,
        "notes": item.notes,
        "photo_url": item.photo_url,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


@router.delete("/inventory/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_inventory_item(
    item_id: str,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> None:
    """Soft-delete an inventory item (sets deleted_at). Never hard-deletes."""
    item = db.query(Inventory).filter(
        Inventory.id == item_id,
        Inventory.profile_id == profile.id,
        Inventory.deleted_at.is_(None),
    ).first()
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found")

    item.deleted_at = datetime.utcnow()
    db.commit()


def _extract_image_url(images: Optional[list]) -> Optional[str]:
    """Pull the small image URL from the V2 API images array (suitable for thumbnails)."""
    if not images:
        return None
    if isinstance(images, list) and images:
        return images[0].get("small") or images[0].get("large")
    return None
