"""Pricing API — card price estimates, sold comps, and per-user pricing preferences.

Endpoints:
  GET  /cards/{card_v2_id}/pricing          — NM anchor + condition-based estimates
  GET  /cards/{card_v2_id}/sold-comps       — recent sold listings from eBay
  GET  /cards/{card_v2_id}/estimated-value  — single estimated value for one condition
  GET  /pricing/preferences                 — get current user's pricing formula settings
  PUT  /pricing/preferences                 — upsert current user's pricing formula settings

On-demand scraping:
  When /pricing is called and no fresh data exists, the endpoint enqueues
  prices.scrape_card_on_demand on the scraper droplet's Redis and returns
  HTTP 202 { "status": "pending" }. Frontend polls until 200 or times out.
"""

import logging
import uuid
from datetime import datetime, timedelta
import math
from statistics import median, mean, quantiles
from typing import Any, Dict, List, Optional

import redis as redis_lib
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db, settings
from app.dependencies import get_current_profile
from urllib.parse import urlencode

from app.models.catalog import PriceSnapshot, SoldComp
from app.models.catalog_v2 import CardV2, ExpansionV2
from app.models.excluded_sold_comps import ExcludedSoldComp
from app.models.pricing_preferences import PricingPreferences
from app.models.profiles import Profile

logger = logging.getLogger(__name__)

router = APIRouter(tags=["pricing"])

# ---------------------------------------------------------------------------
# Constants — used as defaults when no user preferences exist
# ---------------------------------------------------------------------------

PRICING_FRESHNESS_DAYS = 7
COMPS_FRESHNESS_DAYS = 7

DEFAULT_MULTIPLIERS: Dict[str, float] = {
    "nm":  1.00,
    "lp":  0.75,
    "mp":  0.55,
    "hp":  0.35,
    "dmg": 0.15,
}

CONDITION_LABELS: Dict[str, str] = {
    "nm":  "Near Mint",
    "lp":  "Lightly Played",
    "mp":  "Moderately Played",
    "hp":  "Heavily Played",
    "dmg": "Damaged",
}


# ---------------------------------------------------------------------------
# Preferences helpers
# ---------------------------------------------------------------------------

def _get_or_create_preferences(db: Session, profile_id: str) -> PricingPreferences:
    """Return user's PricingPreferences row, creating it with defaults on first access."""
    prefs = db.query(PricingPreferences).filter(
        PricingPreferences.profile_id == profile_id
    ).first()
    if prefs is None:
        prefs = PricingPreferences(
            id=str(uuid.uuid4()),
            profile_id=profile_id,
        )
        db.add(prefs)
        db.commit()
        db.refresh(prefs)
    return prefs


def _effective_multipliers(prefs: PricingPreferences) -> Dict[str, float]:
    """Build the condition→multiplier map from stored preferences."""
    return {
        "nm":  1.00,
        "lp":  float(prefs.lp_multiplier),
        "mp":  float(prefs.mp_multiplier),
        "hp":  float(prefs.hp_multiplier),
        "dmg": float(prefs.dmg_multiplier),
    }


# ---------------------------------------------------------------------------
# Scraper enqueue helpers
# ---------------------------------------------------------------------------

def _get_scraper_app():
    if not settings.scraper_redis_url:
        return None
    try:
        from celery import Celery
        app = Celery(broker=settings.scraper_redis_url)
        app.conf.task_serializer = "json"
        return app
    except Exception as exc:
        logger.error("Failed to connect to scraper Redis: %s", exc)
        return None


def _acquire_scrape_lock(lock_key: str, ttl_seconds: int) -> bool:
    """Set a Redis lock key with NX (only if not exists). Returns True if lock was acquired."""
    if not settings.scraper_redis_url:
        return True  # no Redis — allow enqueue, deduplication not possible
    try:
        r = redis_lib.from_url(settings.scraper_redis_url, socket_connect_timeout=2)
        acquired = r.set(lock_key, 1, nx=True, ex=ttl_seconds)
        return bool(acquired)
    except Exception as exc:
        logger.warning("Redis lock check failed (%s) — allowing enqueue anyway", exc)
        return True


def _enqueue_on_demand(card_v2_id: uuid.UUID) -> bool:
    lock_key = f"scrape_lock:on_demand:{card_v2_id}"
    if not _acquire_scrape_lock(lock_key, ttl_seconds=70):
        logger.info("scrape_card_on_demand already in-flight for %s — skipping duplicate enqueue", card_v2_id)
        return False
    scraper = _get_scraper_app()
    if scraper is None:
        logger.warning("SCRAPER_REDIS_URL not set — skipping on-demand enqueue for %s", card_v2_id)
        return False
    try:
        scraper.send_task("prices.scrape_card_on_demand", args=[str(card_v2_id)])
        logger.info("Enqueued scrape_card_on_demand for %s", card_v2_id)
        return True
    except Exception as exc:
        logger.error("Failed to enqueue scrape task for %s: %s", card_v2_id, exc)
        return False


def _enqueue_ebay_on_demand(
    card_v2_id: uuid.UUID,
    grading_company: Optional[str],
    grade: Optional[str],
    condition_type: Optional[str],
) -> bool:
    gc = grading_company or "none"
    gr = grade or "none"
    ct = condition_type or "none"
    lock_key = f"scrape_lock:ebay:{card_v2_id}:{gc}:{gr}:{ct}"
    if not _acquire_scrape_lock(lock_key, ttl_seconds=70):
        logger.info(
            "scrape_ebay_on_demand already in-flight for %s (%s %s) — skipping duplicate enqueue",
            card_v2_id, grading_company, grade,
        )
        return False
    scraper = _get_scraper_app()
    if scraper is None:
        logger.warning("SCRAPER_REDIS_URL not set — skipping eBay on-demand enqueue for %s", card_v2_id)
        return False
    try:
        scraper.send_task(
            "prices.scrape_ebay_on_demand",
            args=[str(card_v2_id)],
            kwargs={"grading_company": grading_company, "grade": grade, "condition_type": condition_type},
        )
        logger.info("Enqueued scrape_ebay_on_demand for %s (%s %s)", card_v2_id, grading_company, grade)
        return True
    except Exception as exc:
        logger.error("Failed to enqueue eBay scrape task for %s: %s", card_v2_id, exc)
        return False


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _is_pricing_fresh(snapshot: Optional[PriceSnapshot]) -> bool:
    if snapshot is None or snapshot.market_price is None:
        return False
    cutoff = datetime.utcnow() - timedelta(days=PRICING_FRESHNESS_DAYS)
    return snapshot.fetched_at >= cutoff


def _price_estimate(nm_price: float, multiplier: float) -> float:
    return round(nm_price * multiplier, 2)


def _sold_comp_response(comp: SoldComp) -> Dict[str, Any]:
    return {
        "id": str(comp.id),
        "source": comp.source,
        "title": comp.title,
        "description": comp.description,
        "listing_url": comp.listing_url,
        "price": float(comp.price),
        "currency": comp.currency,
        "sold_date": comp.sold_date.isoformat() if comp.sold_date else None,
        "condition_type": comp.condition_type,
        "condition_ungraded": comp.condition_ungraded,
        "grading_company": comp.grading_company,
        "grade": comp.grade,
        "grading_company_other": comp.grading_company_other,
        "sale_type": comp.sale_type,
        "fetched_at": comp.fetched_at.isoformat(),
    }


def _build_ebay_search_url(
    db: Session,
    card_v2_id: uuid.UUID,
    grading_company: Optional[str],
    grade: Optional[str],
) -> Optional[str]:
    """Reconstruct the eBay search URL that would be (or was) used to scrape this card.

    Mirrors the logic in card-ops-droplet/app/services/ebay.py::_build_search_url and
    card-ops-droplet/app/tasks/on_demand.py::_get_card_info.
    """
    card = db.query(CardV2).filter(CardV2.id == card_v2_id).first()
    if card is None:
        return None

    expansion = db.query(ExpansionV2).filter(ExpansionV2.id == card.expansion_id).first()

    # Use English names for eBay queries (same logic as on_demand.py)
    card_name = card.en_name or card.name
    set_name = (expansion.translation or expansion.name) if expansion else ""
    card_number = card.printed_number or card.number

    parts = [p for p in [card_name, card_number, set_name, grading_company, grade] if p]
    query = " ".join(parts)
    graded_yn = "Yes" if (grading_company and grade) else "No"
    params = {
        "_nkw":     query,
        "_sacat":   "0",
        "_from":    "R40",
        "Language": card.language,
        "Graded":   graded_yn,
        "_dcat":    "183454",
        "rt":       "nc",
        "LH_Sold":  "1",
    }
    return "https://www.ebay.com/sch/i.html?" + urlencode(params)


def _aggregate_prices(
    prices: List[float],
    method: str,
    iqr_multiplier: float = 2.0,
    halflife_days: int = 30,
    trim_pct: float = 10.0,
    days_ago: Optional[List[float]] = None,
) -> float:
    """Aggregate a list of prices using the chosen method.

    No automatic outlier removal — that is explicit via the median_iqr method.

    Args:
        prices:        Sale prices, ordered date-descending (most recent first).
        method:        One of median / median_iqr / weighted_recency / trimmed_mean.
        iqr_multiplier: Fence width multiplier for median_iqr (default 2.0).
        halflife_days:  Half-life in days for weighted_recency (default 30).
        trim_pct:       Percent to trim from each end for trimmed_mean (default 10).
        days_ago:       Parallel list of how many days ago each sale occurred,
                        required for weighted_recency; same order as prices.
    """
    if not prices:
        return 0.0

    if method == "median_iqr":
        if len(prices) >= 5:
            q1, _, q3 = quantiles(prices, n=4)
            iqr = q3 - q1
            lo = q1 - iqr_multiplier * iqr
            hi = q3 + iqr_multiplier * iqr
            filtered = [p for p in prices if lo <= p <= hi]
            if len(filtered) >= 3:
                prices = filtered
        return round(median(prices), 2)

    if method == "weighted_recency":
        lam = math.log(2) / max(halflife_days, 1)
        ages = days_ago if days_ago and len(days_ago) == len(prices) else [0.0] * len(prices)
        weights = [math.exp(-lam * d) for d in ages]
        total_w = sum(weights)
        if total_w == 0:
            return round(median(prices), 2)
        return round(sum(p * w for p, w in zip(prices, weights)) / total_w, 2)

    if method == "trimmed_mean":
        n = len(prices)
        cut = max(1, round(n * trim_pct / 100)) if n >= 4 else 0
        trimmed = sorted(prices)[cut: n - cut] if cut else prices
        if not trimmed:
            trimmed = prices
        return round(mean(trimmed), 2)

    # default: median
    return round(median(prices), 2)


# ---------------------------------------------------------------------------
# Preferences endpoints
# ---------------------------------------------------------------------------

VALID_WINDOW_DAYS = {7, 14, 30, 60, 90}
VALID_AGGREGATIONS = {"median", "median_iqr", "weighted_recency", "trimmed_mean"}


class PricingPreferencesResponse(BaseModel):
    lp_multiplier: float
    mp_multiplier: float
    hp_multiplier: float
    dmg_multiplier: float
    graded_comp_window_days: int
    graded_aggregation: str
    graded_iqr_multiplier: float
    graded_recency_halflife_days: int
    graded_trim_pct: float


class PricingPreferencesUpdate(BaseModel):
    lp_multiplier: Optional[float] = Field(None, ge=0, le=1)
    mp_multiplier: Optional[float] = Field(None, ge=0, le=1)
    hp_multiplier: Optional[float] = Field(None, ge=0, le=1)
    dmg_multiplier: Optional[float] = Field(None, ge=0, le=1)
    graded_comp_window_days: Optional[int] = None
    graded_aggregation: Optional[str] = None
    graded_iqr_multiplier: Optional[float] = Field(None, ge=0.5, le=5.0)
    graded_recency_halflife_days: Optional[int] = Field(None, ge=1, le=90)
    graded_trim_pct: Optional[float] = Field(None, ge=1, le=49)


def _prefs_to_response(prefs: PricingPreferences) -> PricingPreferencesResponse:
    return PricingPreferencesResponse(
        lp_multiplier=float(prefs.lp_multiplier),
        mp_multiplier=float(prefs.mp_multiplier),
        hp_multiplier=float(prefs.hp_multiplier),
        dmg_multiplier=float(prefs.dmg_multiplier),
        graded_comp_window_days=prefs.graded_comp_window_days,
        graded_aggregation=prefs.graded_aggregation,
        graded_iqr_multiplier=float(prefs.graded_iqr_multiplier),
        graded_recency_halflife_days=prefs.graded_recency_halflife_days,
        graded_trim_pct=float(prefs.graded_trim_pct),
    )


@router.get("/pricing/preferences", response_model=PricingPreferencesResponse)
def get_pricing_preferences(
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> PricingPreferencesResponse:
    """Return current user's pricing formula settings, creating defaults on first access."""
    return _prefs_to_response(_get_or_create_preferences(db, profile.id))


@router.put("/pricing/preferences", response_model=PricingPreferencesResponse)
def update_pricing_preferences(
    body: PricingPreferencesUpdate,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> PricingPreferencesResponse:
    """Upsert current user's pricing formula settings. Only provided fields are updated."""
    if body.graded_comp_window_days is not None and body.graded_comp_window_days not in VALID_WINDOW_DAYS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"graded_comp_window_days must be one of {sorted(VALID_WINDOW_DAYS)}",
        )
    if body.graded_aggregation is not None and body.graded_aggregation not in VALID_AGGREGATIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"graded_aggregation must be one of {sorted(VALID_AGGREGATIONS)}",
        )

    prefs = _get_or_create_preferences(db, profile.id)

    for field in (
        "lp_multiplier", "mp_multiplier", "hp_multiplier", "dmg_multiplier",
        "graded_comp_window_days", "graded_aggregation",
        "graded_iqr_multiplier", "graded_recency_halflife_days", "graded_trim_pct",
    ):
        val = getattr(body, field)
        if val is not None:
            setattr(prefs, field, val)

    prefs.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(prefs)
    return _prefs_to_response(prefs)


# ---------------------------------------------------------------------------
# Card pricing endpoints
# ---------------------------------------------------------------------------

@router.get("/cards/{card_v2_id}/pricing")
def get_card_pricing(
    card_v2_id: uuid.UUID,
    response: Response,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Return NM market price anchor and estimated prices for all ungraded conditions.

    Condition estimates use the authenticated user's custom multipliers (falling
    back to defaults if no preferences row exists yet).

    Returns 200 with pricing data when fresh data exists.
    Returns 202 with { "status": "pending" } when data is stale/missing.
    """
    snapshots = (
        db.query(PriceSnapshot)
        .filter(
            PriceSnapshot.card_v2_id == card_v2_id,
            PriceSnapshot.source == "tcgplayer",
            PriceSnapshot.market_price.isnot(None),
        )
        .order_by(PriceSnapshot.fetched_at.desc())
        .all()
    )

    snapshot = None
    for preferred in ("holofoil", "normal"):
        snapshot = next((s for s in snapshots if s.variant == preferred), None)
        if snapshot:
            break
    if snapshot is None and snapshots:
        snapshot = snapshots[0]

    if not _is_pricing_fresh(snapshot):
        _enqueue_on_demand(card_v2_id)
        response.status_code = status.HTTP_202_ACCEPTED
        return {
            "card_v2_id": str(card_v2_id),
            "status": "pending",
            "message": "Pricing data is being fetched. Please try again shortly.",
        }

    nm_price = float(snapshot.market_price)
    prefs = _get_or_create_preferences(db, profile.id)
    multipliers = _effective_multipliers(prefs)

    condition_estimates = [
        {
            "condition": condition,
            "label": CONDITION_LABELS[condition],
            "multiplier": multiplier,
            "estimated_price": _price_estimate(nm_price, multiplier),
        }
        for condition, multiplier in multipliers.items()
    ]

    return {
        "card_v2_id": str(card_v2_id),
        "status": "ready",
        "nm_market_price": nm_price,
        "currency": snapshot.currency,
        "source": snapshot.source,
        "fetched_at": snapshot.fetched_at.isoformat(),
        "expires_at": snapshot.expires_at.isoformat(),
        "condition_estimates": condition_estimates,
    }


@router.get("/cards/{card_v2_id}/estimated-value")
def get_card_estimated_value(
    card_v2_id: uuid.UUID,
    response: Response,
    condition_type: str = Query(..., description="'ungraded' or 'graded'"),
    condition_ungraded: Optional[str] = Query(None, description="'nm','lp','mp','hp','dmg'"),
    grading_company: Optional[str] = Query(None),
    grade: Optional[str] = Query(None),
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Return a single estimated value for one specific condition.

    For ungraded: nm_price × user's condition multiplier.
    For graded: aggregates recent sold comps using user's window + method.

    Returns 200 { estimated_value, basis, data_points, window_days }
    Returns 202 { status: "pending" } when underlying data is not yet available.
    """
    prefs = _get_or_create_preferences(db, profile.id)

    if condition_type == "ungraded":
        if not condition_ungraded:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="condition_ungraded is required for ungraded condition_type",
            )

        snapshots = (
            db.query(PriceSnapshot)
            .filter(
                PriceSnapshot.card_v2_id == card_v2_id,
                PriceSnapshot.source == "tcgplayer",
                PriceSnapshot.market_price.isnot(None),
            )
            .order_by(PriceSnapshot.fetched_at.desc())
            .all()
        )
        snapshot = None
        for preferred in ("holofoil", "normal"):
            snapshot = next((s for s in snapshots if s.variant == preferred), None)
            if snapshot:
                break
        if snapshot is None and snapshots:
            snapshot = snapshots[0]

        if not _is_pricing_fresh(snapshot):
            _enqueue_on_demand(card_v2_id)
            response.status_code = status.HTTP_202_ACCEPTED
            return {"card_v2_id": str(card_v2_id), "status": "pending"}

        multipliers = _effective_multipliers(prefs)
        multiplier = multipliers.get(condition_ungraded, 1.0)
        nm_price = float(snapshot.market_price)
        return {
            "card_v2_id": str(card_v2_id),
            "status": "ready",
            "estimated_value": _price_estimate(nm_price, multiplier),
            "basis": "nm_market_price",
            "data_points": 1,
            "window_days": None,
        }

    # Graded — aggregate sold comps
    if not grading_company or not grade:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="grading_company and grade are required for graded condition_type",
        )

    window_days = prefs.graded_comp_window_days
    sold_cutoff = datetime.utcnow() - timedelta(days=window_days)
    fetch_cutoff = datetime.utcnow() - timedelta(days=90)

    cache_check = (
        db.query(SoldComp)
        .filter(
            SoldComp.card_v2_id == card_v2_id,
            SoldComp.condition_type == "graded",
            SoldComp.grading_company == grading_company,
            SoldComp.grade == grade,
            SoldComp.fetched_at >= fetch_cutoff,
        )
        .first()
    )
    if cache_check is None:
        _enqueue_ebay_on_demand(card_v2_id, grading_company, grade, "graded")
        response.status_code = status.HTTP_202_ACCEPTED
        return {"card_v2_id": str(card_v2_id), "status": "pending"}

    # Fetch excluded comp IDs for this user so they are skipped in the estimate
    excluded_ids = {
        row.sold_comp_id
        for row in db.query(ExcludedSoldComp)
        .filter(ExcludedSoldComp.profile_id == profile.id)
        .all()
    }

    now = datetime.utcnow()
    comps = (
        db.query(SoldComp)
        .filter(
            SoldComp.card_v2_id == card_v2_id,
            SoldComp.condition_type == "graded",
            SoldComp.grading_company == grading_company,
            SoldComp.grade == grade,
            SoldComp.sold_date >= sold_cutoff,
            SoldComp.price.isnot(None),
        )
        .order_by(SoldComp.sold_date.desc().nullslast())
        .all()
    )
    comps = [c for c in comps if c.id not in excluded_ids]

    if not comps:
        return {
            "card_v2_id": str(card_v2_id),
            "status": "ready",
            "estimated_value": None,
            "basis": f"sold_comps_{prefs.graded_aggregation}",
            "data_points": 0,
            "window_days": window_days,
        }

    prices = [float(c.price) for c in comps]
    days_ago = [
        (now - c.sold_date).days if c.sold_date else 0.0
        for c in comps
    ]
    estimated = _aggregate_prices(
        prices,
        prefs.graded_aggregation,
        iqr_multiplier=float(prefs.graded_iqr_multiplier),
        halflife_days=prefs.graded_recency_halflife_days,
        trim_pct=float(prefs.graded_trim_pct),
        days_ago=days_ago,
    )

    return {
        "card_v2_id": str(card_v2_id),
        "status": "ready",
        "estimated_value": estimated,
        "basis": f"sold_comps_{prefs.graded_aggregation}",
        "data_points": len(prices),
        "window_days": window_days,
    }


@router.get("/cards/{card_v2_id}/sold-comps")
def get_card_sold_comps(
    card_v2_id: uuid.UUID,
    response: Response,
    condition_type: Optional[str] = Query(None, description="'ungraded' or 'graded'"),
    grading_company: Optional[str] = Query(None),
    grade: Optional[str] = Query(None),
    condition_ungraded: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Return eBay sold comps for a card (up to 90 days) with optional condition filters.

    Each comp includes an `excluded` flag indicating whether the current user
    has excluded it from their price estimation.

    Returns 200 with comps data when cached data exists.
    Returns 202 with { "status": "pending" } when no data is cached yet.
    """
    fetch_cutoff = datetime.utcnow() - timedelta(days=90)
    base_query = db.query(SoldComp).filter(
        SoldComp.card_v2_id == card_v2_id,
        SoldComp.fetched_at >= fetch_cutoff,
    )
    if condition_type is not None:
        base_query = base_query.filter(SoldComp.condition_type == condition_type)
    if grading_company is not None:
        base_query = base_query.filter(SoldComp.grading_company == grading_company)
    if grade is not None:
        base_query = base_query.filter(SoldComp.grade == grade)
    if condition_ungraded is not None:
        base_query = base_query.filter(SoldComp.condition_ungraded == condition_ungraded)

    if base_query.first() is None:
        _enqueue_ebay_on_demand(card_v2_id, grading_company, grade, condition_type)
        response.status_code = status.HTTP_202_ACCEPTED
        return {
            "card_v2_id": str(card_v2_id),
            "status": "pending",
            "message": "Sold comps are being fetched. Please try again shortly.",
        }

    comps = (
        base_query
        .order_by(SoldComp.sold_date.desc().nullslast())
        .limit(limit)
        .all()
    )

    excluded_ids = {
        row.sold_comp_id
        for row in db.query(ExcludedSoldComp)
        .filter(ExcludedSoldComp.profile_id == profile.id)
        .all()
    }

    ebay_url = _build_ebay_search_url(db, card_v2_id, grading_company, grade)

    return {
        "card_v2_id": str(card_v2_id),
        "status": "ready",
        "total": len(comps),
        "ebay_search_url": ebay_url,
        "comps": [
            {**_sold_comp_response(c), "excluded": c.id in excluded_ids}
            for c in comps
        ],
    }


@router.post("/sold-comps/{comp_id}/exclude", status_code=status.HTTP_204_NO_CONTENT)
def exclude_sold_comp(
    comp_id: str,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> None:
    """Mark a sold comp as excluded from this user's price estimation."""
    comp = db.query(SoldComp).filter(SoldComp.id == comp_id).first()
    if comp is None:
        raise HTTPException(status_code=404, detail="Sold comp not found")
    existing = db.query(ExcludedSoldComp).filter(
        ExcludedSoldComp.profile_id == profile.id,
        ExcludedSoldComp.sold_comp_id == comp_id,
    ).first()
    if existing is None:
        db.add(ExcludedSoldComp(profile_id=profile.id, sold_comp_id=comp_id))
        db.commit()


@router.delete("/sold-comps/{comp_id}/exclude", status_code=status.HTTP_204_NO_CONTENT)
def unexclude_sold_comp(
    comp_id: str,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> None:
    """Remove a sold comp exclusion, restoring it to price estimation."""
    row = db.query(ExcludedSoldComp).filter(
        ExcludedSoldComp.profile_id == profile.id,
        ExcludedSoldComp.sold_comp_id == comp_id,
    ).first()
    if row:
        db.delete(row)
        db.commit()
