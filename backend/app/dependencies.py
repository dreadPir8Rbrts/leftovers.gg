"""
FastAPI dependencies for authentication.

get_current_profile — verifies a Supabase JWT from the Authorization header
using Supabase's JWKS endpoint (ES256 asymmetric signing), then returns
the matching public.profiles row. Used by all protected routes.
"""

from typing import Optional, List

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwk, jwt

from sqlalchemy.orm import Session

from app.db.session import get_db, settings
from app.models.profiles import Profile

_bearer = HTTPBearer()

# Module-level JWKS cache — fetched once on first request, reused after.
_jwks_keys: Optional[List[dict]] = None


def _get_jwks() -> List[dict]:
    """Fetch and cache Supabase's public JWKS keys."""
    global _jwks_keys
    if _jwks_keys is not None:
        return _jwks_keys

    if not settings.supabase_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Auth not configured — SUPABASE_URL missing",
        )

    jwks_url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
    try:
        response = httpx.get(jwks_url, timeout=10)
        response.raise_for_status()
        _jwks_keys = response.json()["keys"]
        return _jwks_keys
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch auth keys: {exc}",
        )


def get_current_profile(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> Profile:
    """
    Verify the Bearer JWT issued by Supabase Auth (ES256).
    Returns the public.profiles row for the authenticated user.
    Raises HTTP 401 if the token is missing, expired, or invalid.
    """
    token = credentials.credentials
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        keys = _get_jwks()

        # Match by kid if present, otherwise try all keys
        candidates = [k for k in keys if k.get("kid") == kid] if kid else keys
        if not candidates:
            candidates = keys

        last_exc = None
        payload = None
        for key_data in candidates:
            try:
                public_key = jwk.construct(key_data)
                payload = jwt.decode(
                    token,
                    public_key,
                    algorithms=[header.get("alg", "ES256")],
                    options={"verify_aud": False},
                )
                break
            except JWTError as exc:
                last_exc = exc
                continue

        if payload is None:
            raise last_exc or credentials_exception

        user_id: Optional[str] = payload.get("sub")
        if user_id is None:
            raise credentials_exception

    except JWTError:
        raise credentials_exception

    profile = db.get(Profile, user_id)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found — user may not have completed registration",
        )

    return profile
