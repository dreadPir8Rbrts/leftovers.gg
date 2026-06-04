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

VALID_UNGRADED = {"nm", "lp", "mp", "hp", "dmg"}
VALID_COMPANIES = {"psa", "bgs", "cgc", "other"}
VALID_CARD_STATUSES = {"pc", "fs", "ft", "fs_ft"}


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------

class InventoryItemCreate(BaseModel):
    card_id: str
    condition_type: Literal["ungraded", "graded"]
    condition_ungraded: Optional[str] = None
    grading_company: Optional[str] = None
    grade: Optional[str] = None
    grading_company_other: Optional[str] = None
    quantity: int = Field(1, ge=1)
    acquired_price: Optional[Decimal] = Field(None, ge=0)
    asking_price: Optional[Decimal] = Field(None, ge=0)
    card_status: str = "pc"
    notes: Optional[str] = None

    @field_validator("card_status")
    @classmethod
    def validate_card_status(cls, v: str) -> str:
        if v not in VALID_CARD_STATUSES:
            raise ValueError(f"card_status must be one of {sorted(VALID_CARD_STATUSES)}")
        return v

    @model_validator(mode="after")
    def validate_condition(self) -> "InventoryItemCreate":
        if self.condition_type == "ungraded":
            if not self.condition_ungraded:
                raise ValueError("condition_ungraded is required when condition_type is 'ungraded'")
            if self.condition_ungraded not in VALID_UNGRADED:
                raise ValueError(f"condition_ungraded must be one of {sorted(VALID_UNGRADED)}")
            if self.grading_company or self.grade:
                raise ValueError("grading_company and grade must be null for ungraded items")
        else:  # graded
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
        return self


class InventoryItemResponse(BaseModel):
    id: str
    profile_id: str
    card_id: str
    condition_type: str
    condition_ungraded: Optional[str]
    grading_company: Optional[str]
    grade: Optional[str]
    grading_company_other: Optional[str]
    quantity: int
    acquired_price: Optional[Decimal]
    asking_price: Optional[Decimal]
    card_status: str
    notes: Optional[str]
    photo_url: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class InventoryItemWithCardResponse(BaseModel):
    id: str
    card_id: str
    condition_type: str
    condition_ungraded: Optional[str]
    grading_company: Optional[str]
    grade: Optional[str]
    grading_company_other: Optional[str]
    quantity: int
    acquired_price: Optional[Decimal]
    asking_price: Optional[Decimal]
    card_status: str
    is_public: bool = True
    notes: Optional[str]
    created_at: datetime
    estimated_value: Optional[Decimal] = None
    # Card details from cards_v2 + expansions_v2
    card_name: str
    card_name_en: Optional[str] = None
    card_num: Optional[str]
    set_name: str
    set_name_en: Optional[str] = None
    series_name: Optional[str]   # None for One Piece
    image_url: Optional[str]
    rarity: Optional[str]
    game: str
    language_code: str

    model_config = {"from_attributes": True}


class InventoryItemPatch(BaseModel):
    acquired_price: Optional[Decimal] = Field(None, ge=0)
    asking_price: Optional[Decimal] = Field(None, ge=0)
    card_status: Optional[str] = None
    is_public: Optional[bool] = None
    notes: Optional[str] = None

    @field_validator("card_status")
    @classmethod
    def validate_card_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_CARD_STATUSES:
            raise ValueError(f"card_status must be one of {sorted(VALID_CARD_STATUSES)}")
        return v
