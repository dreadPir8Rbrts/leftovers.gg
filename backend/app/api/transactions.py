"""
Transaction endpoints — authenticated, any profile.

Routes:
  GET    /transactions          — list the current user's transactions (newest first)
  POST   /transactions          — create a transaction
  GET    /transactions/{id}     — get a single transaction with its cards
  PATCH  /transactions/{id}     — update metadata on an existing transaction
  DELETE /transactions/{id}     — soft-delete a transaction
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.pricing import (
    _effective_multipliers,
    _get_or_create_preferences,
    _is_pricing_fresh,
    _price_estimate,
)
from app.db.session import get_db
from app.dependencies import get_current_profile
from app.models.catalog import PriceSnapshot
from app.models.catalog_v2 import CardV2
from app.models.inventory import Inventory
from app.models.pricing_preferences import PricingPreferences
from app.models.profiles import Profile
from app.models.scrydex_prices import ScrydexPrice
from app.models.transactions import Transaction, TransactionCard
from app.services.scrydex import fetch_scrydex_prices, lookup_market_price

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
    variant: Optional[str] = None
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
    fee_pct: Optional[float] = None
    notes: Optional[str] = None
    cards: List[TransactionCardIn] = []
    auto_update_inventory: bool = False


class TransactionPatch(BaseModel):
    transaction_date: Optional[date] = None
    marketplace: Optional[str] = None
    counterparty_name: Optional[str] = None
    fee_pct: Optional[float] = None
    notes: Optional[str] = None


class TransactionCardOut(BaseModel):
    id: str
    direction: str
    card_v2_id: str
    card_name: Optional[str] = None
    card_num: Optional[str] = None
    set_name: Optional[str] = None
    image_url: Optional[str] = None
    game: Optional[str] = None
    inventory_item_id: Optional[str] = None
    acquired_price: Optional[float] = None
    grading_cost: Optional[float] = None
    condition_type: str
    condition_ungraded: Optional[str] = None
    grading_company: Optional[str] = None
    grade: Optional[str] = None
    grading_company_other: Optional[str] = None
    estimated_value: Optional[float] = None
    variant: Optional[str] = None
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
    fee_pct: Optional[float] = None
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


def _card_image_url(images) -> Optional[str]:
    if not images:
        return None
    if isinstance(images, dict):
        return images.get("small") or images.get("large")
    if isinstance(images, list):
        return images[0].get("small") or images[0].get("large")
    return None


def _build_card_out(tc: TransactionCard, card: Optional[CardV2], inv: Optional[Inventory] = None) -> dict:
    return {
        "id": tc.id,
        "direction": tc.direction,
        "card_v2_id": tc.card_v2_id,
        "card_name": card.name if card else None,
        "card_num": card.number if card else None,
        "set_name": card.expansion.name if card else None,
        "image_url": _card_image_url(card.images) if card else None,
        "game": card.game if card else None,
        "inventory_item_id": tc.inventory_item_id,
        "acquired_price": float(inv.acquired_price) if inv and inv.acquired_price is not None else None,
        "grading_cost": float(inv.grading_cost) if inv and inv.grading_cost is not None else None,
        "condition_type": tc.condition_type,
        "condition_ungraded": tc.condition_ungraded,
        "grading_company": tc.grading_company,
        "grade": tc.grade,
        "grading_company_other": tc.grading_company_other,
        "estimated_value": float(tc.estimated_value) if tc.estimated_value is not None else None,
        "variant": tc.variant,
        "quantity": tc.quantity,
    }


def _build_transaction_out(tx: Transaction, db: Session) -> dict:
    card_rows = (
        db.query(TransactionCard, CardV2)
        .outerjoin(CardV2, CardV2.id == TransactionCard.card_v2_id)
        .filter(TransactionCard.transaction_id == tx.id)
        .all()
    )

    # Batch-load inventory items linked to transaction cards for cost basis data
    inv_ids = [tc.inventory_item_id for tc, _ in card_rows if tc.inventory_item_id]
    inv_map: Dict[str, Inventory] = {}
    if inv_ids:
        inv_rows = db.query(Inventory).filter(Inventory.id.in_(inv_ids)).all()
        inv_map = {inv.id: inv for inv in inv_rows}

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
        "fee_pct": float(tx.fee_pct) if tx.fee_pct is not None else None,
        "notes": tx.notes,
        "created_at": tx.created_at,
        "cards": [_build_card_out(tc, card, inv_map.get(tc.inventory_item_id or "")) for tc, card in card_rows],
    }


_SCRYDEX_CACHE_TTL_HOURS = 24


def _extract_prices_list(prices_json: Any) -> List[Any]:
    """Extract the flat prices list from either the old list format or new dict format."""
    if isinstance(prices_json, dict):
        return prices_json.get("prices", [])
    return prices_json or []


def _get_scrydex_prices(db: Session, card_v2_id: str) -> List[Any]:
    """Return cached Scrydex prices for a card, refreshing if stale. Returns [] on failure."""
    stale_cutoff = datetime.utcnow() - timedelta(hours=_SCRYDEX_CACHE_TTL_HOURS)
    card = db.get(CardV2, card_v2_id)
    if not card:
        return []

    cached = db.query(ScrydexPrice).filter(ScrydexPrice.card_v2_id == card_v2_id).first()
    if cached and cached.fetched_at >= stale_cutoff:
        return _extract_prices_list(cached.prices_json)

    if not card.external_id or card.game != "pokemon":
        return _extract_prices_list(cached.prices_json) if cached else []

    prices = fetch_scrydex_prices(card.external_id)
    if prices is None:
        return _extract_prices_list(cached.prices_json) if cached else []

    if cached:
        cached.prices_json = prices
        cached.fetched_at = datetime.utcnow()
    else:
        db.add(ScrydexPrice(card_v2_id=card_v2_id, prices_json=prices, fetched_at=datetime.utcnow()))
    db.commit()
    return _extract_prices_list(prices)


def _estimate_for_card(
    db: Session,
    prefs: PricingPreferences,
    card_v2_id: str,
    condition_type: str,
    condition_ungraded: Optional[str],
    grading_company: Optional[str],
    grade: Optional[str],
    variant: Optional[str] = None,
) -> Optional[float]:
    """Estimate current market value for a card at a given condition/grade.

    Ungraded: TCGPlayer NM price × condition multiplier (user's pricing prefs).
    Graded:   Scrydex market price for the matching company/grade/variant.
    """
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
        prices = _get_scrydex_prices(db, card_v2_id)
        return lookup_market_price(
            prices,
            condition_type=condition_type,
            condition_ungraded=None,
            grading_company=grading_company,
            grade=grade,
            variant=variant,
        )

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


def _auto_update_inventory_items(
    db: Session,
    profile_id: str,
    cards: List[TransactionCardIn],
) -> None:
    """Decrement/remove inventory for lost cards; add inventory for gained cards."""
    now = datetime.now(timezone.utc)
    for c in cards:
        if c.direction == "lost":
            q = (
                db.query(Inventory)
                .filter(
                    Inventory.profile_id == profile_id,
                    Inventory.card_v2_id == c.card_v2_id,
                    Inventory.condition_type == c.condition_type,
                    Inventory.deleted_at.is_(None),
                    Inventory.status == "active",
                )
            )
            if c.condition_type == "ungraded":
                q = q.filter(
                    func.lower(Inventory.condition_ungraded) == (c.condition_ungraded or "").lower()
                )
            else:
                q = q.filter(
                    func.lower(Inventory.grading_company) == (c.grading_company or "").lower(),
                    Inventory.grade == c.grade,
                )
            inv = q.order_by(Inventory.created_at.asc()).first()
            if inv:
                qty_to_remove = max(1, c.quantity)
                if inv.quantity <= qty_to_remove:
                    inv.deleted_at = now
                    inv.updated_at = now
                else:
                    inv.quantity -= qty_to_remove
                    inv.updated_at = now

        elif c.direction == "gained":
            db.add(Inventory(
                id=str(uuid.uuid4()),
                profile_id=profile_id,
                card_v2_id=c.card_v2_id,
                condition_type=c.condition_type,
                condition_ungraded=c.condition_ungraded.lower() if c.condition_ungraded else None,
                grading_company=c.grading_company,
                grade=c.grade,
                grading_company_other=c.grading_company_other,
                variant=c.variant,
                quantity=max(1, c.quantity),
                is_public=False,
                card_status="pc",
                status="active",
            ))


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
        fee_pct=body.fee_pct,
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
            variant=c.variant,
            quantity=c.quantity,
        )
        db.add(tc)

        # Update inventory for cards the user is giving up
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
                now = datetime.now(timezone.utc)
                qty_to_remove = max(1, c.quantity)
                if inv.quantity <= qty_to_remove:
                    # All copies consumed — soft-delete the record
                    inv.status = inventory_status
                    inv.deleted_at = now
                    inv.updated_at = now
                else:
                    # Partial — decrement and leave the record active
                    inv.quantity -= qty_to_remove
                    inv.updated_at = now

    db.commit()
    db.refresh(tx)

    if body.auto_update_inventory:
        _auto_update_inventory_items(db, profile.id, body.cards)
        db.commit()

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
                variant=c.variant,
            )
            estimates.append({
                "inventory_item_id": c.inventory_item_id,
                "card_name": card_map.get(c.inventory_item_id),
                "estimated_value": estimated,
            })
        out["estimated_acquired_prices"] = estimates

    return out


@router.get("/transactions/live-deltas")
def get_live_deltas(
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Recompute the value delta for every non-deleted transaction at current market prices.

    For each transaction:
      live_delta = (cash_gained + Σ current_value(gained cards × qty))
                 − (cash_lost  + Σ current_value(lost  cards × qty))

    Cards whose current price cannot be fetched contribute 0 to the delta.
    `cards_priced` / `cards_total` let the frontend indicate pricing confidence.
    """
    txs = (
        db.query(Transaction)
        .filter(
            Transaction.profile_id == profile.id,
            Transaction.deleted_at.is_(None),
        )
        .all()
    )

    prefs = _get_or_create_preferences(db, profile.id)
    result = []

    for tx in txs:
        card_rows = (
            db.query(TransactionCard)
            .filter(TransactionCard.transaction_id == tx.id)
            .all()
        )

        gained = float(tx.cash_gained) if tx.cash_gained is not None else 0.0
        lost = float(tx.cash_lost) if tx.cash_lost is not None else 0.0
        cards_priced = 0

        for tc in card_rows:
            val = _estimate_for_card(
                db,
                prefs,
                tc.card_v2_id,
                tc.condition_type,
                tc.condition_ungraded,
                tc.grading_company,
                tc.grade,
                variant=tc.variant,
            )
            if val is not None:
                cards_priced += 1
                if tc.direction == "gained":
                    gained += val * tc.quantity
                else:
                    lost += val * tc.quantity

        result.append({
            "transaction_id": tx.id,
            "live_delta": round(gained - lost, 2),
            "cards_priced": cards_priced,
            "cards_total": len(card_rows),
        })

    return result


@router.get("/transactions/{transaction_id}/live-delta")
def get_transaction_live_delta(
    transaction_id: str,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Recompute the live value delta for a single transaction at current market prices."""
    tx = db.query(Transaction).filter(
        Transaction.id == transaction_id,
        Transaction.profile_id == profile.id,
        Transaction.deleted_at.is_(None),
    ).first()
    if tx is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    card_rows = (
        db.query(TransactionCard)
        .filter(TransactionCard.transaction_id == tx.id)
        .all()
    )

    prefs = _get_or_create_preferences(db, profile.id)
    gained = float(tx.cash_gained) if tx.cash_gained is not None else 0.0
    lost = float(tx.cash_lost) if tx.cash_lost is not None else 0.0
    cards_priced = 0

    for tc in card_rows:
        val = _estimate_for_card(
            db, prefs,
            tc.card_v2_id, tc.condition_type, tc.condition_ungraded,
            tc.grading_company, tc.grade, variant=tc.variant,
        )
        if val is not None:
            cards_priced += 1
            if tc.direction == "gained":
                gained += val * tc.quantity
            else:
                lost += val * tc.quantity

    return {
        "transaction_id": tx.id,
        "live_delta": round(gained - lost, 2),
        "cards_priced": cards_priced,
        "cards_total": len(card_rows),
    }


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


@router.patch("/transactions/{transaction_id}", response_model=TransactionOut)
def patch_transaction(
    transaction_id: str,
    body: TransactionPatch,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """Update mutable metadata on an existing transaction (date, marketplace, counterparty, fee_pct, notes)."""
    tx = db.query(Transaction).filter(
        Transaction.id == transaction_id,
        Transaction.profile_id == profile.id,
        Transaction.deleted_at.is_(None),
    ).first()
    if tx is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    for field in body.model_fields_set:
        setattr(tx, field, getattr(body, field))

    db.commit()
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
