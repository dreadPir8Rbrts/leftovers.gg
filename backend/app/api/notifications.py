"""
Notifications endpoints.

Routes:
  GET  /notifications           — list most-recent 30 notifications for current user
  POST /notifications/read-all  — mark all unread notifications as read
  POST /notifications/{id}/read — mark a single notification as read
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies import get_current_profile
from app.models.notification import Notification
from app.models.profiles import Profile

router = APIRouter(tags=["notifications"])


def _actor_summary(p: Profile) -> Dict[str, Any]:
    return {
        "id": p.id,
        "display_name": p.display_name,
        "username": p.username,
        "avatar_url": p.avatar_url,
    }


def _notification_out(n: Notification, actor: Optional[Profile]) -> Dict[str, Any]:
    return {
        "id": n.id,
        "type": n.type,
        "actor": _actor_summary(actor) if actor else None,
        "entity_id": n.entity_id,
        "read_at": n.read_at.isoformat() if n.read_at else None,
        "created_at": n.created_at.isoformat(),
    }


@router.get("/notifications")
def list_notifications(
    current: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    rows = (
        db.query(Notification)
        .filter(Notification.profile_id == current.id)
        .order_by(Notification.created_at.desc())
        .limit(30)
        .all()
    )
    actor_ids = list({n.actor_id for n in rows})
    actors = {p.id: p for p in db.query(Profile).filter(Profile.id.in_(actor_ids)).all()}
    return [_notification_out(n, actors.get(n.actor_id)) for n in rows]


@router.post("/notifications/read-all", status_code=status.HTTP_200_OK)
def mark_all_read(
    current: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    db.query(Notification).filter(
        Notification.profile_id == current.id,
        Notification.read_at.is_(None),
    ).update({"read_at": datetime.utcnow()}, synchronize_session=False)
    db.commit()
    return {"ok": True}


@router.post("/notifications/{notification_id}/read", status_code=status.HTTP_200_OK)
def mark_one_read(
    notification_id: str,
    current: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    n = (
        db.query(Notification)
        .filter(
            Notification.id == notification_id,
            Notification.profile_id == current.id,
        )
        .first()
    )
    if n is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    if n.read_at is None:
        n.read_at = datetime.utcnow()
        db.commit()
    return {"ok": True}
