"""
Scan job endpoints.

Routes:
  POST /scans/identify     — direct Claude Vision identification (new fast path)
  POST /scans              — legacy: create scan job + presigned S3 PUT URL
  GET  /scans/{id}         — legacy: poll scan job status
  WS   /scans/{id}/ws      — legacy: WebSocket push on completion
"""

import base64
import io
import json
import uuid
import asyncio
import logging
from datetime import datetime
from typing import Optional

import anthropic
import boto3
import imagehash
import redis.asyncio as aioredis
from botocore.config import Config
from botocore.exceptions import ClientError
from PIL import Image as PILImage
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

import celery_app as _celery_module

from app.db.session import get_db, SessionLocal, settings
from app.dependencies import get_current_profile
from app.models.catalog_v2 import CardV2, ExpansionV2
from app.models.profiles import Profile
from app.models.scans import ScanJob

logger = logging.getLogger(__name__)
router = APIRouter(tags=["scans"])

PRESIGNED_URL_EXPIRY = 300  # seconds

from app.services.claude_vision import call_claude as _call_claude_service

_CACHE_TTL = 3600  # seconds


# ---------------------------------------------------------------------------
# Direct identify — async helpers
# ---------------------------------------------------------------------------

async def _cache_get(image_bytes: bytes, action: str) -> Optional[str]:
    """Return cached card_id for this image+action, or None on miss/error."""
    try:
        img = PILImage.open(io.BytesIO(image_bytes))
        phash = str(imagehash.phash(img))
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        async with r:
            cached = await r.get(f"scan_cache:{phash}:{action}")
        if cached:
            return json.loads(cached).get("card_id")
    except Exception as exc:
        logger.warning("scan cache get failed: %s", exc)
    return None


async def _cache_set(image_bytes: bytes, action: str, card_id: str) -> None:
    """Write card_id to Redis cache keyed on perceptual hash + action."""
    try:
        img = PILImage.open(io.BytesIO(image_bytes))
        phash = str(imagehash.phash(img))
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        async with r:
            await r.setex(f"scan_cache:{phash}:{action}", _CACHE_TTL, json.dumps({"card_id": card_id}))
    except Exception as exc:
        logger.warning("scan cache set failed: %s", exc)


async def _call_claude(image_bytes: bytes) -> dict:
    """Thin wrapper — delegates to the claude_vision service."""
    return await _call_claude_service(image_bytes, media_type="image/jpeg")


def _log_scan_sync(image_bytes: bytes, profile_id: str, card_id: str, confidence: float, result_raw: dict, action: str) -> None:
    """
    Sync background task (runs in thread pool via FastAPI BackgroundTasks).
    Uploads image to S3 and writes a completed scan_job log record to DB.
    Does not block the HTTP response.
    """
    s3_key = f"scans/{profile_id}/{uuid.uuid4()}.jpg"
    try:
        s3 = boto3.client(
            "s3",
            region_name=settings.aws_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )
        s3.put_object(Bucket=settings.aws_s3_bucket, Key=s3_key, Body=image_bytes, ContentType="image/jpeg")
    except Exception as exc:
        logger.warning("scan log — S3 upload failed: %s", exc)
        s3_key = None

    db = SessionLocal()
    try:
        job = ScanJob(
            id=str(uuid.uuid4()),
            profile_id=profile_id,
            scan_method="full_scan",
            image_s3_key=s3_key,
            status="complete",
            action=action,
            result_card_id=card_id,
            result_confidence=confidence,
            result_raw=result_raw,
            completed_at=datetime.utcnow(),
        )
        db.add(job)
        db.commit()
        logger.info("scan log written: card=%s confidence=%.2f", card_id, confidence)
    except Exception as exc:
        logger.warning("scan log — DB write failed: %s", exc)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# POST /scans/identify  (new fast path)
# ---------------------------------------------------------------------------

class IdentifyResponse(BaseModel):
    # Identification result
    card_id: str
    confidence: float
    claude_card_name: Optional[str] = None  # name Claude read from the card (for debugging)
    # Full card details — avoids a second GET /cards/{id} round-trip
    name: str
    card_num: Optional[str] = None
    rarity: Optional[str] = None
    image_url: Optional[str] = None
    set_name: str
    release_date: Optional[str] = None
    series_name: Optional[str] = None
    game: str
    language_code: str


def _normalize_local_id(local_id: str) -> str:
    """Strip leading zeros (e.g. '044' → '44') to broaden catalog matches."""
    return local_id.lstrip("0") or "0"


def _extract_image_url(images: Optional[list]) -> Optional[str]:
    """Pull the small image URL from the V2 API images array (suitable for thumbnails)."""
    if not images:
        return None
    if isinstance(images, list) and images:
        return images[0].get("small") or images[0].get("large")
    return None


def _lookup_card_with_details(
    db: Session,
    card_id: Optional[str] = None,
    set_code: Optional[str] = None,
    local_id: Optional[str] = None,
) -> Optional[tuple]:
    """Return (CardV2, ExpansionV2) by card_id OR expansion external_id + card number.
    Pokémon-only — set game filter when matching by set_code + local_id."""
    q = (
        db.query(CardV2, ExpansionV2)
        .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
    )
    if card_id:
        return q.filter(CardV2.id == card_id).first()
    local_id_variants = list({local_id, _normalize_local_id(local_id)})
    return q.filter(
        ExpansionV2.external_id == set_code,
        CardV2.number.in_(local_id_variants),
        CardV2.game == "pokemon",
    ).first()


def _build_identify_response(
    card: CardV2,
    expansion: ExpansionV2,
    confidence: float,
    claude_card_name: Optional[str] = None,
) -> dict:
    return {
        "card_id": str(card.id),
        "confidence": confidence,
        "claude_card_name": claude_card_name,
        "name": card.name,
        "card_num": card.number,
        "rarity": card.rarity,
        "image_url": _extract_image_url(card.images),
        "set_name": expansion.name,
        "release_date": str(expansion.release_date) if expansion.release_date else None,
        "series_name": expansion.series,
        "game": card.game,
        "language_code": card.language_code,
    }


@router.post("/scans/identify", response_model=IdentifyResponse)
async def identify_card(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    action: str = "add_inventory",
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> dict:
    """
    Identify a card directly via Claude Vision — no queue, no WebSocket.
    Image is compressed client-side before upload. S3 storage and DB logging
    happen in the background after the response is returned.
    """
    if action not in VALID_ACTIONS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid action '{action}'")

    image_bytes = await image.read()

    # Cache check — instant return for repeat scans of the same card
    cached_card_id = await _cache_get(image_bytes, action)
    if cached_card_id:
        logger.info("identify_card — cache hit: profile=%s card=%s", profile.id, cached_card_id)
        row = _lookup_card_with_details(db, card_id=cached_card_id)
        if row:
            card, expansion = row
            background_tasks.add_task(_log_scan_sync, image_bytes, str(profile.id), cached_card_id, 1.0, {"cached": True}, action)
            return _build_identify_response(card, expansion, 1.0)

    # Call Claude
    try:
        result = await _call_claude(image_bytes)
    except Exception as exc:
        logger.error("identify_card — Claude error: %s", exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="AI service error — please try again")

    confidence = float(result.get("confidence", 0.0))
    logger.info(
        "identify_card — Claude result: name=%r set_code=%r local_id=%r confidence=%.2f",
        result.get("card_name"), result.get("set_code"), result.get("local_id"), confidence,
    )
    if confidence < 0.6:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Could not identify card (confidence {confidence:.2f}) — please search manually",
        )

    set_code = result.get("set_code", "")
    local_id = result.get("local_id", "")
    claude_card_name = result.get("card_name") or None
    local_id_variants = list({local_id, _normalize_local_id(local_id)})

    # Primary lookup: card_name + local_id — most reliable since Claude reads
    # the large printed text. Pokémon-only scan; filter to game='pokemon'.
    row = None
    if claude_card_name and local_id:
        row = (
            db.query(CardV2, ExpansionV2)
            .join(ExpansionV2, CardV2.expansion_id == ExpansionV2.id)
            .filter(
                func.lower(CardV2.name) == claude_card_name.lower(),
                CardV2.number.in_(local_id_variants),
                CardV2.game == "pokemon",
            )
            .first()
        )

    # Fallback: expansion external_id + card number
    if row is None:
        logger.info("identify_card — name lookup miss (name=%r local_id=%r), trying set_code fallback: %s", claude_card_name, local_id, set_code)
        row = _lookup_card_with_details(db, set_code=set_code, local_id=local_id)

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Card not found in catalog: {set_code}/{local_id} (name: {claude_card_name})",
        )

    card, expansion = row

    # Populate cache for repeat scans
    await _cache_set(image_bytes, action, str(card.id))

    background_tasks.add_task(_log_scan_sync, image_bytes, str(profile.id), str(card.id), confidence, result, action)
    return _build_identify_response(card, expansion, confidence, claude_card_name)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ScanJobCreate(BaseModel):
    action: str  # add_inventory | log_sale | log_purchase | log_trade
    content_type: str = "image/jpeg"  # MIME type of the image to be uploaded


class ScanJobResponse(BaseModel):
    id: str
    status: str
    action: str
    upload_url: Optional[str] = None  # only on creation
    result_card_id: Optional[str] = None
    result_confidence: Optional[float] = None
    result_raw: Optional[dict] = None
    error_message: Optional[str] = None

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

VALID_ACTIONS = {"add_inventory", "log_sale", "log_purchase", "log_trade"}


def _require_vendor(profile: Profile) -> None:
    """Raise 403 if the profile is not currently in vendor mode."""
    if profile.role != "vendor":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Vendor role required")


def _generate_presigned_put_url(s3_key: str, content_type: str) -> str:
    """Generate a presigned S3 PUT URL for direct browser upload."""
    if not all([settings.aws_access_key_id, settings.aws_secret_access_key, settings.aws_s3_bucket]):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="S3 not configured",
        )
    s3 = boto3.client(
        "s3",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        config=Config(signature_version="s3v4"),
    )
    try:
        url = s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": settings.aws_s3_bucket,
                "Key": s3_key,
                "ContentType": content_type,
            },
            ExpiresIn=PRESIGNED_URL_EXPIRY,
        )
        return url
    except ClientError as exc:
        logger.error("Failed to generate presigned URL: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to generate upload URL")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/scans", response_model=ScanJobResponse, status_code=status.HTTP_201_CREATED)
def create_scan_job(
    body: ScanJobCreate,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> dict:
    """
    Create a scan job and return a presigned S3 PUT URL.
    Client uploads the image directly to S3, then calls POST /scans/{id}/trigger.
    """
    if body.action not in VALID_ACTIONS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid action '{body.action}'")

    job_id = str(uuid.uuid4())
    s3_key = f"scans/{profile.id}/{job_id}.jpg"

    upload_url = _generate_presigned_put_url(s3_key, body.content_type)

    job = ScanJob(
        id=job_id,
        profile_id=profile.id,
        scan_method="full_scan",
        image_s3_key=s3_key,
        status="pending",
        action=body.action,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    return {
        "id": job.id,
        "status": job.status,
        "action": job.action,
        "upload_url": upload_url,
    }


@router.post("/scans/{scan_job_id}/trigger", status_code=status.HTTP_202_ACCEPTED)
def trigger_scan_job(
    scan_job_id: str,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> dict:
    """
    Called by the client after the image has been uploaded to S3.
    Dispatches the Celery scan task.
    """
    job = db.get(ScanJob, scan_job_id)

    if job is None or job.profile_id != profile.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan job not found")
    if job.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Job already {job.status}")

    _celery_module.app.send_task("scans.process_scan_job", args=[scan_job_id])
    return {"status": "queued", "scan_job_id": scan_job_id}


@router.get("/scans/{scan_job_id}", response_model=ScanJobResponse)
def get_scan_job(
    scan_job_id: str,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> ScanJob:
    """Poll scan job status and result."""
    job = db.get(ScanJob, scan_job_id)

    if job is None or job.profile_id != profile.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan job not found")

    return job


@router.websocket("/scans/{scan_job_id}/ws")
async def scan_job_websocket(
    websocket: WebSocket,
    scan_job_id: str,
    db: Session = Depends(get_db),
) -> None:
    """
    WebSocket endpoint — polls the scan job every second and pushes a completion
    event when status changes to 'complete' or 'failed'. Client connects after
    triggering the scan and waits for the push instead of polling REST.
    """
    await websocket.accept()
    try:
        while True:
            db.expire_all()
            job = db.get(ScanJob, scan_job_id)
            if job is None:
                await websocket.send_text(json.dumps({"error": "job not found"}))
                break

            if job.status in ("complete", "failed"):
                await websocket.send_text(json.dumps({
                    "status": job.status,
                    "result_card_id": job.result_card_id,
                    "result_confidence": float(job.result_confidence) if job.result_confidence else None,
                    "error_message": job.error_message,
                }))
                break

            await asyncio.sleep(1)
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected for scan_job %s", scan_job_id)


# ---------------------------------------------------------------------------
# POST /scans/quick-identify  (Google Cloud Vision OCR fast path)
# ---------------------------------------------------------------------------

class QuickIdentifyResponse(BaseModel):
    matched: bool
    reason: Optional[str] = None          # populated when matched=False
    confidence: Optional[float] = None
    method: Optional[str] = None          # exact | local_id | local_id_hp | fuzzy_name
    ocr: dict                              # raw OCR fields: name, set_number, ocr_num1, ocr_num2, hp, illustrator
    # Full card details — same shape as IdentifyResponse card fields (populated when matched=True)
    card_id: Optional[str] = None
    name: Optional[str] = None
    card_num: Optional[str] = None
    rarity: Optional[str] = None
    image_url: Optional[str] = None
    set_name: Optional[str] = None
    release_date: Optional[str] = None
    series_name: Optional[str] = None
    game: Optional[str] = None
    language_code: Optional[str] = None


@router.post("/scans/quick-identify", response_model=QuickIdentifyResponse)
async def quick_identify(
    image: UploadFile = File(...),
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> dict:
    """
    Quick Scan: Google Cloud Vision OCR + fuzzy catalog match.
    Faster than Claude Vision; no scan_job record or Celery task is created.
    Returns the same card fields as /scans/identify so the frontend can reuse
    the existing confirm → Add to Inventory flow on a successful match.
    """
    from app.services.ocr import extract_card_text
    from app.services.catalog_match import match_card_from_ocr

    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File must be an image")

    image_bytes = await image.read()

    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image must be under 10 MB")

    try:
        ocr_result = await extract_card_text(image_bytes)
    except RuntimeError as exc:
        logger.error("quick_identify — OCR error: %s", exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"OCR service error — please try again")

    logger.info(
        "quick_identify — OCR result: name=%r set_number=%r ocr_num1=%r ocr_num2=%r hp=%r",
        ocr_result.get("name"), ocr_result.get("set_number"),
        ocr_result.get("ocr_num1"), ocr_result.get("ocr_num2"), ocr_result.get("hp"),
    )

    if not ocr_result.get("name") and not ocr_result.get("set_number"):
        return {"matched": False, "reason": "no_text_detected", "ocr": ocr_result}

    match = await asyncio.to_thread(match_card_from_ocr, ocr_result, db)

    if not match:
        logger.info("quick_identify — no catalog match for OCR: %s", ocr_result)
        return {"matched": False, "reason": "no_catalog_match", "ocr": ocr_result}

    card: CardV2 = match["card"]
    expansion: ExpansionV2 = match["expansion"]
    confidence: float = match["confidence"]
    method: str = match["method"]

    logger.info(
        "quick_identify — matched: card=%s confidence=%.2f method=%s",
        card.id, confidence, method,
    )

    return {
        "matched": True,
        "confidence": confidence,
        "method": method,
        "ocr": ocr_result,
        "card_id": str(card.id),
        "name": card.name,
        "card_num": card.number,
        "rarity": card.rarity,
        "image_url": _extract_image_url(card.images),
        "set_name": expansion.name,
        "release_date": str(expansion.release_date) if expansion.release_date else None,
        "series_name": expansion.series,
        "game": card.game,
        "language_code": card.language_code,
    }
