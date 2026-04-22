"""
Shows endpoints — public + authenticated.

Routes (public):
  GET  /shows                      — list upcoming active shows with optional filters
  GET  /shows/{show_id}            — single show by UUID or ontreasure_id slug
  GET  /shows/{show_id}/attendees  — all profiles registered for a show, grouped by role

Routes (authenticated — any profile):
  POST   /shows/{show_id}/register   — register the current user for a show
  DELETE /shows/{show_id}/register   — unregister the current user from a show
  GET    /profile/shows/registered   — shows the current user is attending (any role)

Routes (authenticated vendor):
  GET  /vendor/shows/registered    — shows the current vendor is attending

Routes (authenticated collector):
  GET  /collector/shows/registered — shows the current collector is attending
"""

import uuid
from datetime import date
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import and_, text
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies import get_current_profile
from app.models.profiles import Profile
from app.models.shows import CardShow, ProfileShowRegistration

# ---------------------------------------------------------------------------
# Zip code → lat/lon resolution (module-level cache, lives for process lifetime)
# ---------------------------------------------------------------------------

_zip_cache: Dict[str, Tuple[float, float]] = {}


def _resolve_zip(zip_code: str) -> Optional[Tuple[float, float]]:
    """
    Resolve a US zip code to (latitude, longitude) via Nominatim.
    Results are cached in-process so repeated searches for the same zip
    cost only one network call.
    """
    key = zip_code.strip()
    if key in _zip_cache:
        return _zip_cache[key]

    try:
        from geopy.geocoders import Nominatim

        geolocator = Nominatim(user_agent="cardops-api/1.0")
        location = geolocator.geocode(
            f"{key}, USA",
            addressdetails=False,
            language="en",
            timeout=10,
        )
        if location:
            coords = (location.latitude, location.longitude)
            _zip_cache[key] = coords
            return coords
    except Exception:
        pass

    return None


router = APIRouter(tags=["shows"])


class ShowAttendeeResponse(BaseModel):
    profile_id: str
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    role: str

    model_config = {"from_attributes": True}


class ShowResponse(BaseModel):
    id: str
    ontreasure_id: str
    name: str
    date_start: date
    date_end: Optional[date] = None
    time_range: Optional[str] = None
    venue_name: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    ticket_price: Optional[str] = None
    table_price: Optional[str] = None
    poster_url: Optional[str] = None
    organizer_name: Optional[str] = None
    description: Optional[str] = None
    source_url: str

    model_config = {"from_attributes": True}


def _build_response(show: CardShow) -> dict:
    return {
        "id": str(show.id),
        "ontreasure_id": show.ontreasure_id,
        "name": show.name,
        "date_start": show.date_start,
        "date_end": show.date_end,
        "time_range": show.time_range,
        "venue_name": show.venue_name,
        "city": show.city,
        "state": show.state,
        "address": show.address,
        "latitude": float(show.latitude) if show.latitude is not None else None,
        "longitude": float(show.longitude) if show.longitude is not None else None,
        "ticket_price": show.ticket_price,
        "table_price": show.table_price,
        "poster_url": show.poster_url,
        "organizer_name": show.organizer_name,
        "description": show.description,
        "source_url": show.source_url,
    }


# ---------------------------------------------------------------------------
# Public routes
# ---------------------------------------------------------------------------

@router.get("/shows", response_model=List[ShowResponse])
def list_shows(
    state: Optional[str] = Query(None, description="Filter by 2-letter state abbreviation e.g. NY"),
    from_date: Optional[date] = Query(None, description="Shows starting on or after this date"),
    until_date: Optional[date] = Query(None, description="Shows starting on or before this date"),
    zip_code: Optional[str] = Query(None, description="Filter shows within radius_miles of this US zip code"),
    latitude: Optional[float] = Query(None, description="Filter shows within radius_miles of this latitude"),
    longitude: Optional[float] = Query(None, description="Filter shows within radius_miles of this longitude"),
    radius_miles: float = Query(50.0, ge=1, le=500, description="Radius in miles for location filter"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """List upcoming active card shows, ordered by date ascending."""
    filters = [
        CardShow.status == "active",
        CardShow.date_start >= (from_date or date.today()),
    ]
    if state:
        filters.append(CardShow.state == state.upper())
    if until_date:
        filters.append(CardShow.date_start <= until_date)

    # Resolve zip code to coordinates if provided
    center_lat: Optional[float] = latitude
    center_lon: Optional[float] = longitude

    if zip_code and (center_lat is None or center_lon is None):
        coords = _resolve_zip(zip_code)
        if coords is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Could not resolve zip code: {zip_code}",
            )
        center_lat, center_lon = coords

    # Apply haversine distance filter when coordinates are available.
    # Only includes shows that have lat/lon populated.
    if center_lat is not None and center_lon is not None:
        haversine = text(
            "latitude IS NOT NULL AND longitude IS NOT NULL AND "
            "3959 * acos("
            "  LEAST(1.0, "
            "    cos(radians(:lat)) * cos(radians(latitude)) "
            "    * cos(radians(longitude) - radians(:lon)) "
            "    + sin(radians(:lat)) * sin(radians(latitude))"
            "  )"
            ") <= :radius"
        ).bindparams(lat=center_lat, lon=center_lon, radius=radius_miles)
        filters.append(haversine)

    shows = (
        db.query(CardShow)
        .filter(and_(*filters))
        .order_by(CardShow.date_start.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_build_response(s) for s in shows]


@router.get("/shows/{show_id}", response_model=ShowResponse)
def get_show(show_id: str, db: Session = Depends(get_db)):
    """Get a single show by UUID or ontreasure_id slug."""
    show = (
        db.query(CardShow)
        .filter(
            (CardShow.ontreasure_id == show_id) |
            (CardShow.id == show_id)
        )
        .first()
    )
    if show is None:
        raise HTTPException(status_code=404, detail="Show not found")
    return _build_response(show)


@router.get("/shows/{show_id}/attendees", response_model=List[ShowAttendeeResponse])
def list_show_attendees(show_id: str, db: Session = Depends(get_db)):
    """
    List all profiles registered as attending a show, with their role.
    Vendors and collectors are differentiated by the role field.
    """
    show = db.query(CardShow).filter(CardShow.id == show_id).first()
    if show is None:
        raise HTTPException(status_code=404, detail="Show not found")

    rows = (
        db.query(Profile, ProfileShowRegistration)
        .join(ProfileShowRegistration, ProfileShowRegistration.profile_id == Profile.id)
        .filter(ProfileShowRegistration.show_id == show_id)
        .order_by(Profile.display_name.asc())
        .all()
    )
    return [
        {
            "profile_id": profile.id,
            "display_name": profile.display_name,
            "avatar_url": profile.avatar_url,
            "bio": profile.bio,
            "role": reg.attending_as or profile.role,
        }
        for profile, reg in rows
    ]


# ---------------------------------------------------------------------------
# Authenticated routes — any profile (vendor or collector)
# ---------------------------------------------------------------------------

class RegisterForShowRequest(BaseModel):
    attending_as: Optional[str] = None  # 'vendor' | 'collector' — defaults to profile.role


@router.post("/shows/{show_id}/register", status_code=status.HTTP_201_CREATED)
def register_for_show(
    show_id: str,
    body: RegisterForShowRequest = RegisterForShowRequest(),
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """Register the authenticated user as attending a show."""
    show = db.query(CardShow).filter(CardShow.id == show_id).first()
    if show is None:
        raise HTTPException(status_code=404, detail="Show not found")

    attending_as = body.attending_as or profile.role
    if attending_as not in ("vendor", "collector"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="attending_as must be 'vendor' or 'collector'",
        )

    existing = (
        db.query(ProfileShowRegistration)
        .filter(
            ProfileShowRegistration.profile_id == profile.id,
            ProfileShowRegistration.show_id == show_id,
        )
        .first()
    )
    if existing:
        # Update attending_as if it changed (e.g. user switches vendor ↔ collector)
        if existing.attending_as != attending_as:
            existing.attending_as = attending_as
            db.add(existing)
            db.commit()
        return {"id": str(existing.id), "show_id": show_id, "profile_id": profile.id, "attending_as": attending_as}

    reg = ProfileShowRegistration(
        id=str(uuid.uuid4()),
        profile_id=profile.id,
        show_id=show_id,
        attending_as=attending_as,
    )
    db.add(reg)
    db.commit()
    return {"id": str(reg.id), "show_id": show_id, "profile_id": profile.id, "attending_as": attending_as}


@router.delete("/shows/{show_id}/register", status_code=status.HTTP_204_NO_CONTENT)
def unregister_from_show(
    show_id: str,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """Unregister the authenticated user from a show."""
    reg = (
        db.query(ProfileShowRegistration)
        .filter(
            ProfileShowRegistration.profile_id == profile.id,
            ProfileShowRegistration.show_id == show_id,
        )
        .first()
    )
    if reg is None:
        raise HTTPException(status_code=404, detail="Registration not found")

    db.delete(reg)
    db.commit()


# ---------------------------------------------------------------------------
# Authenticated routes — any profile
# ---------------------------------------------------------------------------

@router.get("/profile/shows/registrations")
def list_my_show_registrations(
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> List[dict]:
    """
    Return the current user's show registrations as {show_id, attending_as}.
    Used by the frontend to know which role the user registered as for each show.
    """
    regs = (
        db.query(ProfileShowRegistration)
        .filter(ProfileShowRegistration.profile_id == profile.id)
        .all()
    )
    return [
        {"show_id": str(r.show_id), "attending_as": r.attending_as or profile.role}
        for r in regs
    ]


@router.get("/profile/shows/registered", response_model=List[ShowResponse])
def list_my_registered_shows(
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """List upcoming shows the current user is registered for, regardless of role."""
    shows = (
        db.query(CardShow)
        .join(ProfileShowRegistration, ProfileShowRegistration.show_id == CardShow.id)
        .filter(
            ProfileShowRegistration.profile_id == profile.id,
            CardShow.date_start >= date.today(),
        )
        .order_by(CardShow.date_start.asc())
        .all()
    )
    return [_build_response(s) for s in shows]


# ---------------------------------------------------------------------------
# Authenticated vendor routes
# ---------------------------------------------------------------------------

@router.get("/vendor/shows/registered", response_model=List[ShowResponse])
def list_vendor_registered_shows(
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """List upcoming shows the authenticated vendor is registered for."""
    if profile.role != "vendor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Vendor profile required",
        )
    shows = (
        db.query(CardShow)
        .join(ProfileShowRegistration, ProfileShowRegistration.show_id == CardShow.id)
        .filter(
            ProfileShowRegistration.profile_id == profile.id,
            CardShow.date_start >= date.today(),
        )
        .order_by(CardShow.date_start.asc())
        .all()
    )
    return [_build_response(s) for s in shows]


# ---------------------------------------------------------------------------
# Authenticated collector routes
# ---------------------------------------------------------------------------

@router.get("/collector/shows/registered", response_model=List[ShowResponse])
def list_collector_registered_shows(
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """List upcoming shows the authenticated collector is registered for."""
    if profile.role != "collector":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Collector profile required",
        )
    shows = (
        db.query(CardShow)
        .join(ProfileShowRegistration, ProfileShowRegistration.show_id == CardShow.id)
        .filter(
            ProfileShowRegistration.profile_id == profile.id,
            CardShow.date_start >= date.today(),
        )
        .order_by(CardShow.date_start.asc())
        .all()
    )
    return [_build_response(s) for s in shows]
