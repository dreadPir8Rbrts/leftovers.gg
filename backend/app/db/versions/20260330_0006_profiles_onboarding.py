"""Add onboarding columns to profiles and update role constraint.

Revision ID: 0006
Revises: 0005
Create Date: 2026-03-30

Changes:
  - Drop old role check constraint (vendor | customer | admin)
  - Add new role check constraint (vendor | collector | both | admin)
  - Add display_name VARCHAR(50)
  - Add tcg_interests JSON
  - Add onboarding_complete BOOLEAN NOT NULL DEFAULT false
  - Add zip_code VARCHAR(10)
  - Add avatar_url VARCHAR(500)
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Update role constraint — drop old (vendor|customer|admin), add new (vendor|collector|both|admin)
    op.execute("ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check")
    op.execute("ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS ck_profiles_role")
    op.execute("""
        ALTER TABLE public.profiles
        ADD CONSTRAINT ck_profiles_role
        CHECK (role IN ('vendor', 'collector', 'both', 'admin'))
    """)

    # New profile columns for onboarding
    op.add_column(
        "profiles",
        sa.Column("display_name", sa.VARCHAR(50), nullable=True),
        schema="public",
    )
    op.add_column(
        "profiles",
        sa.Column("tcg_interests", sa.JSON(), nullable=True),
        schema="public",
    )
    op.add_column(
        "profiles",
        sa.Column(
            "onboarding_complete",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        schema="public",
    )
    op.add_column(
        "profiles",
        sa.Column("zip_code", sa.VARCHAR(10), nullable=True),
        schema="public",
    )
    op.add_column(
        "profiles",
        sa.Column("avatar_url", sa.VARCHAR(500), nullable=True),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("profiles", "avatar_url", schema="public")
    op.drop_column("profiles", "zip_code", schema="public")
    op.drop_column("profiles", "onboarding_complete", schema="public")
    op.drop_column("profiles", "tcg_interests", schema="public")
    op.drop_column("profiles", "display_name", schema="public")

    op.execute("ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS ck_profiles_role")
    op.execute("""
        ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_role_check
        CHECK (role IN ('vendor', 'customer', 'admin'))
    """)
