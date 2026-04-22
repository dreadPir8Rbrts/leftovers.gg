from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from app.db.session import Base, settings

# Import all models so their tables are registered on Base.metadata
import app.models  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Alembic must use the DIRECT Supabase connection URL, not the pooler.
# PgBouncer transaction mode cannot run DDL (CREATE TABLE, ALTER TABLE, etc.).
# Set MIGRATION_DATABASE_URL in .env to the direct URL; falls back to DATABASE_URL
# for local Postgres where no pooler is involved.
#
# We create the engine directly (not via config.set_main_option) to avoid
# Python's configparser interpolating % characters in URL-encoded passwords.
#
# Alembic is scoped to the `public` schema only.
# Never reference or modify the `auth` schema — it is managed exclusively by Supabase.
migration_url = settings.migration_database_url or settings.database_url


def run_migrations_offline() -> None:
    context.configure(
        url=migration_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(migration_url, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
