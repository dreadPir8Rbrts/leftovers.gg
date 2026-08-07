"""
Messaging endpoints — conversations and messages.

Routes:
  GET  /conversations                              — list own conversations
  POST /conversations                              — start or find DM with a profile
  GET  /conversations/{conversation_id}/messages  — paginated message history
  POST /conversations/{conversation_id}/messages  — send a message
  POST /conversations/{conversation_id}/read      — mark all messages in thread as read
"""

import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies import get_current_profile
from app.models.conversation import Conversation, ConversationParticipant, Message
from app.models.profiles import Profile

router = APIRouter(tags=["messaging"])


class SendMessageBody(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)


def _message_out(m: Message) -> Dict[str, Any]:
    return {
        "id": m.id,
        "conversation_id": m.conversation_id,
        "sender_id": m.sender_id,
        "body": m.body,
        "created_at": m.created_at.isoformat(),
        "read_at": m.read_at.isoformat() if m.read_at else None,
    }


def _conversation_out(
    conv: Conversation,
    other: Profile,
    last_message: Optional[Message],
    unread_count: int,
) -> Dict[str, Any]:
    return {
        "id": conv.id,
        "created_at": conv.created_at.isoformat(),
        "other_participant": {
            "id": other.id,
            "display_name": other.display_name,
            "username": other.username,
            "avatar_url": other.avatar_url,
        },
        "last_message": _message_out(last_message) if last_message else None,
        "unread_count": unread_count,
    }


@router.get("/conversations")
def list_conversations(
    current: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    my_convs = (
        db.query(ConversationParticipant.conversation_id)
        .filter(ConversationParticipant.profile_id == current.id)
        .subquery()
    )
    conversations = (
        db.query(Conversation)
        .filter(Conversation.id.in_(my_convs))
        .all()
    )

    results = []
    for conv in conversations:
        other_participant = (
            db.query(Profile)
            .join(ConversationParticipant, ConversationParticipant.profile_id == Profile.id)
            .filter(
                ConversationParticipant.conversation_id == conv.id,
                ConversationParticipant.profile_id != current.id,
            )
            .first()
        )
        if other_participant is None:
            continue
        last_message = (
            db.query(Message)
            .filter(Message.conversation_id == conv.id)
            .order_by(Message.created_at.desc())
            .first()
        )
        unread_count = (
            db.query(func.count(Message.id))
            .filter(
                Message.conversation_id == conv.id,
                Message.sender_id != current.id,
                Message.read_at.is_(None),
            )
            .scalar()
            or 0
        )
        results.append(_conversation_out(conv, other_participant, last_message, unread_count))

    results.sort(
        key=lambda c: c["last_message"]["created_at"] if c["last_message"] else c["created_at"],
        reverse=True,
    )
    return results


@router.post("/conversations", status_code=status.HTTP_201_CREATED)
def start_or_find_conversation(
    body: Dict[str, str],
    current: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    other_profile_id = body.get("profile_id", "")
    if not other_profile_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="profile_id required")
    if other_profile_id == current.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot message yourself")
    other = db.query(Profile).filter(Profile.id == other_profile_id).first()
    if other is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")

    # Find existing conversation between the two participants
    my_convs = (
        db.query(ConversationParticipant.conversation_id)
        .filter(ConversationParticipant.profile_id == current.id)
        .subquery()
    )
    their_convs = (
        db.query(ConversationParticipant.conversation_id)
        .filter(ConversationParticipant.profile_id == other_profile_id)
        .subquery()
    )
    existing = (
        db.query(Conversation)
        .filter(Conversation.id.in_(my_convs), Conversation.id.in_(their_convs))
        .first()
    )
    if existing:
        last_message = (
            db.query(Message)
            .filter(Message.conversation_id == existing.id)
            .order_by(Message.created_at.desc())
            .first()
        )
        return _conversation_out(existing, other, last_message, 0)

    conv = Conversation(id=str(uuid.uuid4()))
    db.add(conv)
    db.flush()
    db.add(ConversationParticipant(conversation_id=conv.id, profile_id=current.id))
    db.add(ConversationParticipant(conversation_id=conv.id, profile_id=other_profile_id))
    db.commit()
    db.refresh(conv)
    return _conversation_out(conv, other, None, 0)


@router.get("/conversations/{conversation_id}/messages")
def get_messages(
    conversation_id: str,
    before: Optional[str] = Query(None, description="Cursor — created_at of oldest loaded message"),
    limit: int = Query(50, le=100),
    current: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    _assert_participant(db, conversation_id, current.id)
    q = db.query(Message).filter(Message.conversation_id == conversation_id)
    if before:
        q = q.filter(Message.created_at < before)
    messages = q.order_by(Message.created_at.desc()).limit(limit).all()
    return [_message_out(m) for m in reversed(messages)]


@router.post("/conversations/{conversation_id}/messages", status_code=status.HTTP_201_CREATED)
def send_message(
    conversation_id: str,
    body: SendMessageBody,
    current: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    _assert_participant(db, conversation_id, current.id)
    msg = Message(
        id=str(uuid.uuid4()),
        conversation_id=conversation_id,
        sender_id=current.id,
        body=body.body.strip(),
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return _message_out(msg)


@router.post("/conversations/{conversation_id}/read", status_code=status.HTTP_200_OK)
def mark_read(
    conversation_id: str,
    current: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    _assert_participant(db, conversation_id, current.id)
    from datetime import datetime
    db.query(Message).filter(
        Message.conversation_id == conversation_id,
        Message.sender_id != current.id,
        Message.read_at.is_(None),
    ).update({"read_at": datetime.utcnow()}, synchronize_session=False)
    db.commit()
    return {"ok": True}


def _assert_participant(db: Session, conversation_id: str, profile_id: str) -> None:
    participant = (
        db.query(ConversationParticipant)
        .filter(
            ConversationParticipant.conversation_id == conversation_id,
            ConversationParticipant.profile_id == profile_id,
        )
        .first()
    )
    if participant is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a participant")
