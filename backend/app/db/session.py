import base64
import json
from typing import Optional

from google.oauth2 import service_account
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    # Direct (non-pooler) URL used by Alembic for DDL migrations.
    # Supabase's PgBouncer transaction mode cannot execute DDL.
    # Falls back to database_url if not set (fine for local Postgres).
    migration_database_url: Optional[str] = None
    redis_url: str = "redis://localhost:6379/0"
    # Separate Redis on the scraper droplet — used only to enqueue on-demand
    # scrape tasks. Kept separate from redis_url so the main app's own Celery
    # broker is never coupled to the droplet.
    scraper_redis_url: Optional[str] = None
    supabase_url: Optional[str] = None
    supabase_service_key: Optional[str] = None  # for server-side admin operations (Phase 2+)
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_s3_bucket: Optional[str] = None
    aws_region: str = "us-east-1"
    anthropic_api_key: Optional[str] = None
    google_credentials_base64: str = ""
    google_translate_api_key: Optional[str] = None
    justtcg_api_key: Optional[str] = None
    pokedata_api_key: Optional[str] = None
    v2_api_key: Optional[str] = None
    v2_api_team_id: Optional[str] = None

    model_config = {"env_file": ".env"}

    @property
    def google_vision_credentials(self) -> Optional[service_account.Credentials]:
        if not self.google_credentials_base64:
            return None
        key_data = json.loads(base64.b64decode(self.google_credentials_base64))
        return service_account.Credentials.from_service_account_info(
            key_data,
            scopes=["https://www.googleapis.com/auth/cloud-vision"],
        )


settings = Settings()

engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
