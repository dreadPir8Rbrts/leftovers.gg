"""
Pydantic v2 request/response schemas for inventory.
"""

from datetime import datetime
from decimal import Decimal
from typing import Optional, List, Literal

from pydantic import BaseModel, Field, model_validator, field_validator


# ---------------------------------------------------------------------------
# Condition validation constants
# ---------------------------------------------------------------------------

VALID_UNGRADED = {"nm+", "nm", "nm-", "lp+", "lp", "lp-", "mp+", "mp", "mp-", "hp", "dmg"}
VALID_COMPANIES = {"psa", "bgs", "cgc", "other"}
VALID_CARD_STATUSES = {"pc", "fs", "ft", "fs_ft"}
VALID_SEALED_CONDITIONS = {"factory_sealed", "seal_damaged", "box_damaged", "damaged"}


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------

class InventoryItemCreate(BaseModel):
    # Exactly one of card_id or sealed_product_id must be provided
    card_id: Optional[str] = None
    sealed_product_id: Optional[str] = None

    condition_type: Literal["ungraded", "graded", "sealed"]
    condition_ungraded: Optional[str] = None
    grading_company: Optional[str] = None
    grade: Optional[str] = None
    grading_company_other: Optional[str] = None
    quantity: int = Field(1, ge=1)
    acquired_price: Optional[Decimal] = Field(None, ge=0)
    grading_cost: Optional[Decimal] = Field(None, ge=0)
    asking_price: Optional[Decimal] = Field(None, ge=0)
    card_status: str = "pc"
    variant: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("card_status")
    @classmethod
    def validate_card_status(cls, v: str) -> str:
        if v not in VALID_CARD_STATUSES:
            raise ValueError(f"card_status must be one of {sorted(VALID_CARD_STATUSES)}")
        return v

    @model_validator(mode="after")
    def validate_item(self) -> "InventoryItemCreate":
        # Item type exclusivity
        if self.card_id and self.sealed_product_id:
            raise ValueError("Provide card_id or sealed_product_id, not both")
        if not self.card_id and not self.sealed_product_id:
            raise ValueError("One of card_id or sealed_product_id is required")

        # Sealed products must have condition_type='sealed'
        if self.sealed_product_id and self.condition_type != "sealed":
            raise ValueError("condition_type must be 'sealed' for sealed products")
        if self.card_id and self.condition_type == "sealed":
            raise ValueError("condition_type 'sealed' is only valid for sealed products")

        # Condition field validation
        if self.condition_type == "ungraded":
            if not self.condition_ungraded:
                raise ValueError("condition_ungraded is required when condition_type is 'ungraded'")
            if self.condition_ungraded not in VALID_UNGRADED:
                raise ValueError(f"condition_ungraded must be one of {sorted(VALID_UNGRADED)}")
            if self.grading_company or self.grade:
                raise ValueError("grading_company and grade must be null for ungraded items")
        elif self.condition_type == "graded":
            if not self.grading_company:
                raise ValueError("grading_company is required when condition_type is 'graded'")
            if self.grading_company not in VALID_COMPANIES:
                raise ValueError(f"grading_company must be one of {sorted(VALID_COMPANIES)}")
            if not self.grade:
                raise ValueError("grade is required when condition_type is 'graded'")
            if self.condition_ungraded:
                raise ValueError("condition_ungraded must be null for graded items")
            if self.grading_company == "other" and not self.grading_company_other:
                raise ValueError("grading_company_other is required when grading_company is 'other'")
        else:  # sealed
            if self.condition_ungraded and self.condition_ungraded not in VALID_SEALED_CONDITIONS:
                raise ValueError(f"condition_ungraded must be one of {sorted(VALID_SEALED_CONDITIONS)} for sealed items")
            if self.grading_company or self.grade:
                raise ValueError("grading_company and grade must be null for sealed items")
        return self


class InventoryItemResponse(BaseModel):
    id: str
    profile_id: str
    card_id: Optional[str]
    condition_type: str
    condition_ungraded: Optional[str]
    grading_company: Optional[str]
    grade: Optional[str]
    grading_company_other: Optional[str]
    quantity: int
    acquired_price: Optional[Decimal]
    grading_cost: Optional[Decimal] = None
    asking_price: Optional[Decimal]
    card_status: str
    variant: Optional[str] = None
    notes: Optional[str]
    photo_url: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class InventoryItemPhotoOut(BaseModel):
    id: str
    photo_url: str
    sort_order: int
    created_at: datetime

    model_config = {"from_attributes": True}


class InventoryItemWithCardResponse(BaseModel):
    id: str
    item_type: str = "card"  # "card" | "sealed"
    card_id: Optional[str] = None
    sealed_product_id: Optional[str] = None
    condition_type: str
    condition_ungraded: Optional[str]
    grading_company: Optional[str]
    grade: Optional[str]
    grading_company_other: Optional[str]
    quantity: int
    acquired_price: Optional[Decimal]
    grading_cost: Optional[Decimal] = None
    asking_price: Optional[Decimal]
    card_status: str
    variant: Optional[str] = None
    is_public: bool = True
    notes: Optional[str]
    photos: List[InventoryItemPhotoOut] = []
    created_at: datetime
    estimated_value: Optional[Decimal] = None
    # Card fields (None for sealed items)
    card_name: Optional[str] = None
    card_name_en: Optional[str] = None
    card_num: Optional[str] = None
    set_name: Optional[str] = None
    set_name_en: Optional[str] = None
    series_name: Optional[str] = None
    image_url: Optional[str] = None
    rarity: Optional[str] = None
    game: Optional[str] = None
    language_code: Optional[str] = None
    # Sealed product fields (None for card items)
    sealed_product_name: Optional[str] = None
    product_type: Optional[str] = None

    model_config = {"from_attributes": True}


class InventoryItemPatch(BaseModel):
    acquired_price: Optional[Decimal] = Field(None, ge=0)
    grading_cost: Optional[Decimal] = Field(None, ge=0)
    asking_price: Optional[Decimal] = Field(None, ge=0)
    quantity: Optional[int] = Field(None, ge=1)
    card_status: Optional[str] = None
    variant: Optional[str] = None
    is_public: Optional[bool] = None
    notes: Optional[str] = None

    @field_validator("card_status")
    @classmethod
    def validate_card_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_CARD_STATUSES:
            raise ValueError(f"card_status must be one of {sorted(VALID_CARD_STATUSES)}")
        return v
