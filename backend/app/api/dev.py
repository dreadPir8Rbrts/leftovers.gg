"""
Dev/exploration endpoints. Not intended for production use.

Routes:
  GET /dev/justtcg/{path}   — proxy any JustTCG API v1 path with all query params
  GET /dev/pokedata/{path}  — proxy any Pokedata API v0 path with all query params
"""

from typing import Optional, Union

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.db.session import settings
from app.dependencies import get_current_profile

router = APIRouter(tags=["dev"])

JUSTTCG_BASE = "https://api.justtcg.com/v1"
POKEDATA_BASE = "https://www.pokedata.io/v0"


@router.get("/dev/justtcg/{path:path}")
async def proxy_justtcg(
    path: str,
    request: Request,
    _profile=Depends(get_current_profile),  # require auth — dev tool, not public
) -> Union[dict, list]:
    """
    Proxy a GET request to the JustTCG API.

    All query parameters from the incoming request are forwarded as-is.
    The JUSTTCG_API_KEY from server settings is injected as the X-API-Key header
    so the key is never exposed to the browser.
    """
    if not settings.justtcg_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="JUSTTCG_API_KEY is not configured on the server.",
        )

    url = f"{JUSTTCG_BASE}/{path}"
    # Forward all query params from the browser request
    params = dict(request.query_params)

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(
                url,
                params=params,
                headers={"X-API-Key": settings.justtcg_api_key},
            )
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"JustTCG request failed: {exc}",
            ) from exc

    # Surface the upstream status code for visibility
    if resp.status_code >= 500:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"JustTCG returned {resp.status_code}: {resp.text[:300]}",
        )

    return resp.json()


@router.get("/dev/pokedata/{path:path}")
async def proxy_pokedata(
    path: str,
    request: Request,
    _profile=Depends(get_current_profile),
) -> Union[dict, list]:
    """
    Proxy a GET request to the Pokedata API (https://www.pokedata.io/v0).

    All query parameters are forwarded as-is.
    The POKEDATA_API_KEY is injected as a Bearer token so the key stays server-side.
    """
    if not settings.pokedata_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="POKEDATA_API_KEY is not configured on the server.",
        )

    url = f"{POKEDATA_BASE}/{path}"
    params = dict(request.query_params)

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(
                url,
                params=params,
                headers={"Authorization": f"Bearer {settings.pokedata_api_key}"},
            )
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Pokedata request failed: {exc}",
            ) from exc

    if resp.status_code >= 500:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Pokedata returned {resp.status_code}: {resp.text[:300]}",
        )

    return resp.json()
