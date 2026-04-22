"""Add sale_type column to sold_comps table.

Revision ID: 0027
Revises: 0026
Create Date: 2026-04-17

Notes:
- sale_type is nullable so existing rows are unaffected.
- Values: 'buy_now' | 'auction' | 'obo' (or Best Offer).
- Enforced with a check constraint (no ENUMs per project convention).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0027"
down_revision: Union[str, None] = "0026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sold_comps",
        sa.Column("sale_type", sa.VARCHAR(20), nullable=True),
        schema="public",
    )
    op.create_check_constraint(
        "ck_sold_comps_sale_type",
        "sold_comps",
        "sale_type IN ('buy_now', 'auction', 'obo')",
        schema="public",
    )


def downgrade() -> None:
    op.drop_constraint("ck_sold_comps_sale_type", "sold_comps", schema="public")
    op.drop_column("sold_comps", "sale_type", schema="public")
