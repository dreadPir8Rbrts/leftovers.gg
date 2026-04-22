"""
Celery application factory and beat schedule for CardOps.

Workers are started with:
    celery -A celery_app worker --loglevel=info

Beat scheduler is started with:
    celery -A celery_app beat --loglevel=info
"""

from celery import Celery
from celery.schedules import crontab

from app.db.session import settings

app = Celery(
    "cardops",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        # TCGdex tasks — kept for reference; beat schedule entries removed (frozen)
        "app.tasks.catalog_sync",
        "app.tasks.price_sync",
        "app.tasks.scan_pipeline",
        # V2 API catalog sync tasks — active catalog source
        "app.tasks.catalog_sync_v2",
        # Card show scrape tasks
        "app.tasks.shows_sync",
    ],
)

app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    # Beat schedule — all times UTC
    beat_schedule={
        # TCGdex catalog syncs removed — V2 API is now the catalog source.
        # catalog_sync.py tasks are still importable but no longer scheduled.
        #
        # "catalog-sync-new-sets": removed 2026-04-06
        # "catalog-delta-sync":    removed 2026-04-06

        # Existing price refresh for TCGplayer/Cardmarket snapshots (references cards table)
        "prices-refresh": {
            "task": "prices.refresh_active_inventory",
            "schedule": crontab(minute=0, hour="*/6"),   # every 6 hours
        },

        # V2 API full catalog sync — runs weekly, handles all games
        # For the initial data load, trigger manually:
        #     celery -A celery_app call v2_api.full_sync
        "v2-api-full-sync": {
            "task": "v2_api.full_sync",
            "schedule": crontab(hour=4, minute=0, day_of_week=0),  # Sunday 4am UTC
        },

        # Weekly OnTreasure card show scrape
        "shows-scrape-ontreasure": {
            "task": "shows.scrape_ontreasure",
            "schedule": crontab(hour=4, minute=0, day_of_week=1),  # every Monday 4am UTC
        },

        # v2_api.refresh_prices is NOT scheduled here — Phase 2 activation pending.
        # See tasks/full_tcg_api_ingestion_plan.md for credit cost analysis before enabling.
        # "v2-api-refresh-prices": {
        #     "task": "v2_api.refresh_prices",
        #     "schedule": crontab(hour="*/6", minute=0),
        # },
    },
)
