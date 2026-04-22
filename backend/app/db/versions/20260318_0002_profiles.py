"""public.profiles — bridge table from Supabase auth.users to app data

Revision ID: 0002
Revises: 0001
Create Date: 2026-03-18

`public.profiles` is the single bridge between Supabase-managed auth and all
application tables. Supabase owns auth lifecycle (email, password, OAuth,
created_at) via auth.users. We never duplicate those fields here.

vendor_profiles and customer_profiles hang off profiles.id via FK.

Notes:
- The FK to auth.users is cross-schema and outside Alembic's managed scope,
  so it is written as raw SQL via op.execute().
- A Supabase database trigger (configured in the Supabase dashboard, not here)
  should auto-insert a public.profiles row on auth.users creation (Phase 1).
- Alembic autogenerate will not detect auth.users and will not try to drop it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # public.profiles references auth.users(id) which is managed by Supabase.
    # We use raw SQL because Alembic cannot model cross-schema FKs to tables
    # it does not own.
    op.execute("""
        CREATE TABLE public.profiles (
            id   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
            role VARCHAR NOT NULL,
            CONSTRAINT profiles_role_check CHECK (role IN ('vendor', 'customer', 'admin'))
        )
    """)


def downgrade() -> None:
    op.drop_table("profiles")
