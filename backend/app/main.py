import logging

logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import catalog
from app.api import collector
from app.api import dev
from app.api import discover
from app.api import pricing
from app.api import profiles
from app.api import vendor
from app.api import scans
from app.api import shows
from app.api import transactions

app = FastAPI(title="CardOps API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://leftovers-gg-isud9.ondigitalocean.app",
        "https://leftovers.gg",
        "https://www.leftovers.gg",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(catalog.router, prefix="/api/v1")
app.include_router(collector.router, prefix="/api/v1")
app.include_router(discover.router, prefix="/api/v1")
app.include_router(dev.router, prefix="/api/v1")
app.include_router(pricing.router, prefix="/api/v1")
app.include_router(profiles.router, prefix="/api/v1")
app.include_router(vendor.router, prefix="/api/v1")
app.include_router(scans.router, prefix="/api/v1")
app.include_router(shows.router, prefix="/api/v1")
app.include_router(transactions.router, prefix="/api/v1")
