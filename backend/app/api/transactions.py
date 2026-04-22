"""
Transaction endpoints — authenticated, any profile.

Routes:
  GET    /transactions          — list the current user's transactions (newest first)
  POST   /transactions          — create a transaction
  GET    /transactions/{id}     — get a single transaction with its cards
  DELETE /transactions/{id}     — soft-delete a transaction
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.pricing import (
    _aggregate_prices,
    _effective_multipliers,
    _get_or_create_preferences,
    _is_pricing_fresh,
    _price_estimate,
)
from app.db.session import get_db
from app.dependencies import get_current_profile
from app.models.catalog import PriceSnapshot, SoldComp
from app.models.catalog_v2 import CardV2
from app.models.inventory import Inventory
from app.models.pricing_preferences import PricingPreferences
from app.models.profiles import Profile
from app.models.transactions import Transaction, TransactionCard

router = APIRouter(tags=["transactions"])

# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

VALID_TYPES = {"buy", "sell", "trade"}
VALID_DIRECTIONS = {"gained", "lost"}
VALID_INVENTORY_STATUSES = {"sold": "sell", "traded": "trade"}  # type → status


class TransactionCardIn(BaseModel):
    direction: str                          # 'gained' | 'lost'
    card_v2_id: str
    inventory_item_id: Optional[str] = None
    condition_type: str
    condition_ungraded: Optional[str] = None
    grading_company: Optional[str] = None
    grade: Optional[str] = None
    grading_company_other: Optional[str] = None
    estimated_value: Optional[float] = None
    quantity: int = 1


class TransactionIn(BaseModel):
    transaction_type: str
    transaction_date: date
    marketplace: Optional[str] = None
    show_id: Optional[str] = None
    counterparty_profile_id: Optional[str] = None
    counterparty_name: Optional[str] = None
    cash_gained: Optional[float] = None
    cash_lost: Optional[float] = None
    transaction_value: Optional[float] = None   # None → auto-compute
    notes: Optional[str] = None
    cards: List[TransactionCardIn] = []


class TransactionCardOut(BaseModel):
    id: str
    direction: str
    card_v2_id: str
    card_name: Optional[str] = None
    card_num: Optional[str] = None
    set_name: Optional[str] = None
    image_url: Optional[str] = None
    inventory_item_id: Optional[str] = None
    condition_type: str
    condition_ungraded: Optional[str] = None
    grading_company: Optional[str] = None
    grade: Optional[str] = None
    grading_company_other: Optional[str] = None
    estimated_value: Optional[float] = None
    quantity: int


class EstimatedAcquiredPrice(BaseModel):
    inventory_item_id: str
    card_name: Optional[str]
    estimated_value: Optional[float]


class TransactionOut(BaseModel):
    id: str
    profile_id: str
    transaction_type: str
    transaction_date: date
    marketplace: Optional[str] = None
    show_id: Optional[str] = None
    counterparty_profile_id: Optional[str] = None
    counterparty_name: Optional[str] = None
    cash_gained: Optional[float] = None
    cash_lost: Optional[float] = None
    transaction_value: Optional[float] = None
    notes: Optional[str] = None
    created_at: datetime
    cards: List[TransactionCardOut] = []
    estimated_acquired_prices: Optional[List[EstimatedAcquiredPrice]] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _compute_value(
    cash_gained: Optional[float],
    cash_lost: Optional[float],
    cards: List[TransactionCardIn],
) -> float:
    """Auto-compute transaction_value from cash + card estimated values."""
    gained = (cash_gained or 0.0) + sum(
        (c.estimated_value or 0.0) * c.quantity
        for c in cards
        if c.direction == "gained"
    )
    lost = (cash_lost or 0.0) + sum(
        (c.estimated_value or 0.0) * c.quantity
        for c in cards
        if c.direction == "lost"
    )
    return round(gained - lost, 2)


def _build_card_out(tc: TransactionCard, card: Optional[CardV2]) -> dict:
    return {
        "id": tc.id,
        "direction": tc.direction,
        "card_v2_id": tc.card_v2_id,
        "card_name": card.name if card else None,
        "card_num": card.card_num if card else None,
        "set_name": card.set_name if card else None,
        "image_url": card.image_url if card else None,
        "inventory_item_id": tc.inventory_item_id,
        "condition_type": tc.condition_type,
        "condition_ungraded": tc.condition_ungraded,
        "grading_company": tc.grading_company,
        "grade": tc.grade,
        "grading_company_other": tc.grading_company_other,
        "estimated_value": float(tc.estimated_value) if tc.estimated_value is not None else None,
        "quantity": tc.quantity,
    }


def _build_transaction_out(tx: Transaction, db: Session) -> dict:
    card_rows = (
        db.query(TransactionCard, CardV2)
        .outerjoin(CardV2, CardV2.id == TransactionCard.card_v2_id)
        .filter(TransactionCard.transaction_id == tx.id)
        .all()
    )
    return {
        "id": tx.id,
        "profile_id": tx.profile_id,
        "transaction_type": tx.transaction_type,
        "transaction_date": tx.transaction_date,
        "marketplace": tx.marketplace,
        "show_id": tx.show_id,
        "counterparty_profile_id": tx.counterparty_profile_id,
        "counterparty_name": tx.counterparty_name,
        "cash_gained": float(tx.cash_gained) if tx.cash_gained is not None else None,
        "cash_lost": float(tx.cash_lost) if tx.cash_lost is not None else None,
        "transaction_value": float(tx.transaction_value) if tx.transaction_value is not None else None,
        "notes": tx.notes,
        "created_at": tx.created_at,
        "cards": [_build_card_out(tc, card) for tc, card in card_rows],
    }


def _estimate_for_card(
    db: Session,
    prefs: PricingPreferences,
    card_v2_id: str,
    condition_type: str,
    condition_ungraded: Optional[str],
    grading_company: Optional[str],
    grade: Optional[str],
) -> Optional[float]:
    """Compute an estimated value for a single inventory card using the user's pricing preferences."""
    if condition_type == "ungraded" and condition_ungraded:
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
            return None
        multipliers = _effective_multipliers(prefs)
        nm_price = float(snapshot.market_price)
        return _price_estimate(nm_price, multipliers.get(condition_ungraded, 1.0))

    if condition_type == "graded" and grading_company and grade:
        sold_cutoff = datetime.utcnow() - timedelta(days=prefs.graded_comp_window_days)
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
        if not comps:
            return None
        return _aggregate_prices([float(c.price) for c in comps], prefs.graded_aggregation)

    return None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/transactions", response_model=List[TransactionOut])
def list_transactions(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """List the current user's transactions, newest first."""
    txs = (
        db.query(Transaction)
        .filter(
            Transaction.profile_id == profile.id,
            Transaction.deleted_at.is_(None),
        )
        .order_by(Transaction.transaction_date.desc(), Transaction.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_build_transaction_out(tx, db) for tx in txs]


@router.post("/transactions", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def create_transaction(
    body: TransactionIn,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """
    Create a transaction and optionally update inventory item statuses.

    For sell transactions: linked inventory items (direction='lost') are marked 'sold'.
    For trade transactions: linked inventory items (direction='lost') are marked 'traded'.
    """
    if body.transaction_type not in VALID_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"transaction_type must be one of: {', '.join(VALID_TYPES)}",
        )
    for c in body.cards:
        if c.direction not in VALID_DIRECTIONS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"card direction must be 'gained' or 'lost', got '{c.direction}'",
            )

    # Compute value if not provided
    value = body.transaction_value
    if value is None:
        value = _compute_value(body.cash_gained, body.cash_lost, body.cards)

    tx = Transaction(
        id=str(uuid.uuid4()),
        profile_id=profile.id,
        transaction_type=body.transaction_type,
        transaction_date=body.transaction_date,
        marketplace=body.marketplace,
        show_id=body.show_id,
        counterparty_profile_id=body.counterparty_profile_id,
        counterparty_name=body.counterparty_name,
        cash_gained=body.cash_gained,
        cash_lost=body.cash_lost,
        transaction_value=value,
        notes=body.notes,
    )
    db.add(tx)
    db.flush()  # get tx.id before inserting cards

    # Determine inventory status update based on transaction type
    inventory_status: Optional[str] = None
    if body.transaction_type == "sell":
        inventory_status = "sold"
    elif body.transaction_type == "trade":
        inventory_status = "traded"

    for c in body.cards:
        tc = TransactionCard(
            id=str(uuid.uuid4()),
            transaction_id=tx.id,
            direction=c.direction,
            card_v2_id=c.card_v2_id,
            inventory_item_id=c.inventory_item_id,
            condition_type=c.condition_type,
            condition_ungraded=c.condition_ungraded,
            grading_company=c.grading_company,
            grade=c.grade,
            grading_company_other=c.grading_company_other,
            estimated_value=c.estimated_value,
            quantity=c.quantity,
        )
        db.add(tc)

        # Update inventory status for cards the user is giving up
        if (
            c.direction == "lost"
            and c.inventory_item_id
            and inventory_status
        ):
            inv = db.query(Inventory).filter(
                Inventory.id == c.inventory_item_id,
                Inventory.profile_id == profile.id,
            ).first()
            if inv:
                inv.status = inventory_status
                inv.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(tx)
    out = _build_transaction_out(tx, db)

    # Compute estimated acquired prices for gained cards that link to an inventory item
    gained_with_item = [c for c in body.cards if c.direction == "gained" and c.inventory_item_id]
    if gained_with_item:
        prefs = _get_or_create_preferences(db, profile.id)
        # Build card name lookup from cards already fetched in _build_transaction_out
        card_map: Dict[str, Optional[str]] = {}
        for card_out in out["cards"]:
            card_map[card_out["inventory_item_id"] or ""] = card_out["card_name"]

        estimates = []
        for c in gained_with_item:
            estimated = _estimate_for_card(
                db,
                prefs,
                c.card_v2_id,
                c.condition_type,
                c.condition_ungraded,
                c.grading_company,
                c.grade,
            )
            estimates.append({
                "inventory_item_id": c.inventory_item_id,
                "card_name": card_map.get(c.inventory_item_id),
                "estimated_value": estimated,
            })
        out["estimated_acquired_prices"] = estimates

    return out


@router.get("/transactions/{transaction_id}", response_model=TransactionOut)
def get_transaction(
    transaction_id: str,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """Get a single transaction with all its cards."""
    tx = db.query(Transaction).filter(
        Transaction.id == transaction_id,
        Transaction.profile_id == profile.id,
        Transaction.deleted_at.is_(None),
    ).first()
    if tx is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return _build_transaction_out(tx, db)


@router.delete("/transactions/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    transaction_id: str,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """Soft-delete a transaction. Does not revert inventory status changes."""
    tx = db.query(Transaction).filter(
        Transaction.id == transaction_id,
        Transaction.profile_id == profile.id,
        Transaction.deleted_at.is_(None),
    ).first()
    if tx is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    tx.deleted_at = datetime.now(timezone.utc)
    db.commit()
