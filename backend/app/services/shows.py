"""
Show upsert service — sync, uses the standard SQLAlchemy Session.

Called by the Celery scrape task and can be called directly for manual imports.
"""

import logging
import re
from datetime import datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.shows import CardShow

logger = logging.getLogger(__name__)

# Tags like "+3", "+140" are OnTreasure UI overflow indicators — not real tags
_OVERFLOW_TAG_RE = re.compile(r"^\+\d+$")


def _clean_str(val: object, max_len: Optional[int] = None) -> Optional[str]:
    if not val or not str(val).strip():
        return None
    s = str(val).strip()
    if max_len:
        s = s[:max_len]
    return s


def _clean_event(raw: Dict) -> Dict:
    """
    Normalize a scraped event dict before writing to DB.

    - Strips overflow tags ("+3", "+140")
    - Collapses time_start / time_end into a single time_range string
    - Enforces state as exactly 2 uppercase chars or None
    - Truncates fields that exceed column widths
    - Replaces empty strings with None
    """
    tags = [
        t for t in (raw.get("tags") or [])
        if t and not _OVERFLOW_TAG_RE.match(str(t))
    ]
    tags = list(dict.fromkeys(tags))  # deduplicate, preserve order

    ts = _clean_str(raw.get("time_start"))
    te = _clean_str(raw.get("time_end"))
    if ts and te and ts == te:
        time_range = ts
    elif ts and te:
        time_range = "{} \u2013 {}".format(ts, te)
    else:
        time_range = ts or te

    state = _clean_str(raw.get("state"))
    if state and len(state) != 2:
        state = None

    return {
        "ontreasure_id": raw["source_id"],
        "source_url": raw["source_url"],
        "name": _clean_str(raw.get("name"), 300),
        "date_start": raw["date_start"],
        "date_end": raw.get("date_end"),
        "time_range": _clean_str(time_range, 50) if time_range else None,
        "venue_name": _clean_str(raw.get("venue_name"), 300),
        "address": _clean_str(raw.get("address"), 500),
        "street": _clean_str(raw.get("street"), 300),
        "city": _clean_str(raw.get("city"), 100),
        "state": state,
        "zip_code": _clean_str(raw.get("zip_code"), 10),
        "latitude": raw.get("latitude"),
        "longitude": raw.get("longitude"),
        "description": _clean_str(raw.get("description")),
        "tags": tags,
        "organizer_name": _clean_str(raw.get("organizer_name"), 200),
        "organizer_handle": _clean_str(raw.get("organizer_handle"), 200),
        "ticket_price": _clean_str(raw.get("ticket_price"), 20),
        "table_price": _clean_str(raw.get("table_price"), 20),
        "poster_url": _clean_str(raw.get("poster_url"), 500),
        "status": "active",
        "source": "ontreasure",
        "last_scraped_at": datetime.now(timezone.utc),
    }


def upsert_shows(events: List[Dict], session: Session) -> Dict:
    """
    Upsert a list of scraped event dicts into card_shows.

    Uses INSERT ... ON CONFLICT (ontreasure_id) DO UPDATE — safe to call
    repeatedly. Existing rows are updated; new rows are inserted.

    Returns: {"upserted": N, "skipped": N}
    """
    if not events:
        return {"upserted": 0, "skipped": 0}

    cleaned = []
    skipped = 0
    for raw in events:
        if not raw.get("source_id") or not raw.get("date_start"):
            skipped += 1
            continue
        try:
            cleaned.append(_clean_event(raw))
        except Exception as exc:
            logger.warning("Skipping event due to clean error: %s", exc)
            skipped += 1

    if not cleaned:
        return {"upserted": 0, "skipped": skipped}

    stmt = insert(CardShow).values(cleaned)
    stmt = stmt.on_conflict_do_update(
        index_elements=["ontreasure_id"],
        set_={
            "name": stmt.excluded.name,
            "date_start": stmt.excluded.date_start,
            "date_end": stmt.excluded.date_end,
            "time_range": stmt.excluded.time_range,
            "venue_name": stmt.excluded.venue_name,
            "address": stmt.excluded.address,
            "street": stmt.excluded.street,
            "city": stmt.excluded.city,
            "state": stmt.excluded.state,
            "zip_code": stmt.excluded.zip_code,
            "latitude": stmt.excluded.latitude,
            "longitude": stmt.excluded.longitude,
            "description": stmt.excluded.description,
            "tags": stmt.excluded.tags,
            "organizer_name": stmt.excluded.organizer_name,
            "organizer_handle": stmt.excluded.organizer_handle,
            "ticket_price": stmt.excluded.ticket_price,
            "table_price": stmt.excluded.table_price,
            "poster_url": stmt.excluded.poster_url,
            "last_scraped_at": stmt.excluded.last_scraped_at,
            "updated_at": datetime.now(timezone.utc),
        },
    )

    session.execute(stmt)
    session.commit()
    return {"upserted": len(cleaned), "skipped": skipped}
