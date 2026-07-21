"""
Inventory endpoints.

Routes:
  POST /inventory            — add inventory item (authenticated)
  GET  /inventory            — list own inventory with filters (authenticated)
  POST /vendor/profile/image — generate presigned S3 URL for profile image upload
"""

import logging
import uuid
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Tuple

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db, SessionLocal, settings
from app.dependencies import get_current_profile
from app.models.inventory import Inventory
from app.models.profiles import Profile
from app.models.catalog_v2 import CardV2, ExpansionV2
from app.models.scrydex_prices import ScrydexPrice
from app.schemas.vendor import (
    InventoryItemCreate,
    InventoryItemPatch,
    InventoryItemResponse,
    InventoryItemWithCardResponse,
)
from app.api.pricing import _enqueue_ebay_on_demand
from app.services.scrydex import fetch_scrydex_prices, lookup_market_price

logger = logging.getLogger(__name__)

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
        card_status=body.card_status,
        variant=body.variant,
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
        "card_status": item.card_status,
        "variant": item.variant,
        "notes": item.notes,
        "photo_url": item.photo_url,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def _refresh_scrydex_cache(cards: List[Tuple[str, str]]) -> None:
    """Background task: fetch and upsert Scrydex prices for stale/missing cards."""
    db = SessionLocal()
    try:
        for card_v2_id, external_id in cards:
            result = fetch_scrydex_prices(external_id)
            if result is None:
                continue
            prices_list = result["prices"] if isinstance(result, dict) else result
            existing = db.query(ScrydexPrice).filter(ScrydexPrice.card_v2_id == card_v2_id).first()
            if existing:
                existing.prices_json = prices_list
                existing.fetched_at = datetime.utcnow()
            else:
                db.add(ScrydexPrice(
                    card_v2_id=card_v2_id,
                    prices_json=prices_list,
                    fetched_at=datetime.utcnow(),
                ))
            db.commit()
    except Exception as exc:
        logger.error("Scrydex cache refresh error: %s", exc)
    finally:
        db.close()


@router.get("/inventory", response_model=List[InventoryItemWithCardResponse])
def list_inventory(
    background_tasks: BackgroundTasks,
    condition_type: Optional[str] = Query(None),
    card_id: Optional[str] = Query(None),
    card_status: Optional[str] = Query(None),
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
    if card_status:
        query = query.filter(Inventory.card_status == card_status)

    rows = query.order_by(Inventory.created_at.desc()).offset(offset).limit(limit).all()

    # ---------------------------------------------------------------------------
    # Scrydex price cache lookup
    # ---------------------------------------------------------------------------
    SCRYDEX_CACHE_TTL_HOURS = 24
    stale_cutoff = datetime.utcnow() - timedelta(hours=SCRYDEX_CACHE_TTL_HOURS)

    # Collect unique (card_v2_id, external_id) pairs for all inventory items
    card_external: Dict[str, str] = {}
    for item, card, _ in rows:
        if card.external_id and card.game == "pokemon":
            card_external[str(item.card_v2_id)] = card.external_id

    # Batch-fetch cached Scrydex prices
    scrydex_cache: Dict[str, List] = {}
    needs_refresh: List[Tuple[str, str]] = []

    if card_external:
        cached_rows = (
            db.query(ScrydexPrice)
            .filter(ScrydexPrice.card_v2_id.in_(list(card_external.keys())))
            .all()
        )
        cached_by_id = {row.card_v2_id: row for row in cached_rows}

        for card_v2_id, external_id in card_external.items():
            cached = cached_by_id.get(card_v2_id)
            if cached and cached.fetched_at >= stale_cutoff:
                pj = cached.prices_json
                scrydex_cache[card_v2_id] = pj.get("prices", []) if isinstance(pj, dict) else (pj or [])
            else:
                needs_refresh.append((card_v2_id, external_id))

    if needs_refresh:
        background_tasks.add_task(_refresh_scrydex_cache, needs_refresh)

    result = []
    for item, card, expansion in rows:
        prices = scrydex_cache.get(str(item.card_v2_id), [])
        estimated_value = lookup_market_price(
            prices,
            item.condition_type,
            item.condition_ungraded,
            item.grading_company,
            item.grade,
            item.variant,
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
            "card_status": item.card_status,
            "variant": item.variant,
            "is_public": item.is_public,
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
    if body.card_status is not None:
        item.card_status = body.card_status
    if body.variant is not None:
        item.variant = body.variant
    if body.is_public is not None:
        item.is_public = body.is_public
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
        "card_status": item.card_status,
        "variant": item.variant,
        "is_public": item.is_public,
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
