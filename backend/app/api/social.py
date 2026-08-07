"""
Social endpoints — follow/unfollow and follower/following lists.

Routes:
  POST   /profiles/{profile_id}/follow      — follow a profile
  DELETE /profiles/{profile_id}/follow      — unfollow a profile
  GET    /profiles/{profile_id}/followers   — list followers
  GET    /profiles/{profile_id}/following   — list following
  GET    /profiles/{profile_id}/follow/status — is current user following this profile?
"""

import uuid
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies import get_current_profile
from app.models.follow import Follow
from app.models.notification import Notification
from app.models.profiles import Profile

router = APIRouter(tags=["social"])


def _profile_summary(p: Profile) -> Dict[str, Any]:
    return {
        "id": p.id,
        "display_name": p.display_name,
        "username": p.username,
        "avatar_url": p.avatar_url,
    }


@router.post("/profiles/{profile_id}/follow", status_code=status.HTTP_201_CREATED)
def follow_profile(
    profile_id: str,
    current: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    if profile_id == current.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot follow yourself")
    target = db.query(Profile).filter(Profile.id == profile_id).first()
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")
    existing = (
        db.query(Follow)
        .filter(Follow.follower_id == current.id, Follow.following_id == profile_id)
        .first()
    )
    if existing:
        return {"following": True}
    follow = Follow(follower_id=current.id, following_id=profile_id)
    db.add(follow)
    notification = Notification(
        id=str(uuid.uuid4()),
        profile_id=profile_id,
        type="follow",
        actor_id=current.id,
    )
    db.add(notification)
    db.commit()
    return {"following": True}


@router.delete("/profiles/{profile_id}/follow", status_code=status.HTTP_200_OK)
def unfollow_profile(
    profile_id: str,
    current: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    follow = (
        db.query(Follow)
        .filter(Follow.follower_id == current.id, Follow.following_id == profile_id)
        .first()
    )
    if follow:
        db.delete(follow)
        db.commit()
    return {"following": False}


@router.get("/profiles/{profile_id}/follow/status")
def follow_status(
    profile_id: str,
    current: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    is_following = (
        db.query(Follow)
        .filter(Follow.follower_id == current.id, Follow.following_id == profile_id)
        .first()
        is not None
    )
    follower_count = db.query(Follow).filter(Follow.following_id == profile_id).count()
    return {"following": is_following, "follower_count": follower_count}


@router.get("/profiles/{profile_id}/followers")
def list_followers(
    profile_id: str,
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    rows = (
        db.query(Profile)
        .join(Follow, Follow.follower_id == Profile.id)
        .filter(Follow.following_id == profile_id)
        .order_by(Follow.created_at.desc())
        .all()
    )
    return [_profile_summary(p) for p in rows]


@router.get("/profiles/{profile_id}/following")
def list_following(
    profile_id: str,
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    rows = (
        db.query(Profile)
        .join(Follow, Follow.following_id == Profile.id)
        .filter(Follow.follower_id == profile_id)
        .order_by(Follow.created_at.desc())
        .all()
    )
    return [_profile_summary(p) for p in rows]
