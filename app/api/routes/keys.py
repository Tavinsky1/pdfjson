"""
Key management routes.

POST /keys         — create a new API key (public signup endpoint)
GET  /keys/usage   — return usage info for the authenticated key
DELETE /keys/me    — revoke the authenticated key
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import generate_api_key, get_current_key
from app.core.config import settings
from app.db.database import get_db
from app.models.db import ApiKey
from app.models.schemas import CreateKeyRequest, CreateKeyResponse, KeyUsageResponse

router = APIRouter()


@router.post(
    "/keys",
    response_model=CreateKeyResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new API key",
)
async def create_key(
    body: CreateKeyRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Generate a new API key on the free tier.
    The raw key is returned exactly once — **store it securely**.
    """
    raw_key, hashed = generate_api_key()

    now = datetime.now(timezone.utc)
    key_row = ApiKey(
        key_hash=hashed,
        label=body.label,
        email=body.email,
        tier="free",
        usage_count=0,
        usage_reset_at=_next_reset(now),
        revoked=False,
    )
    db.add(key_row)
    await db.commit()
    await db.refresh(key_row)

    limit = settings.tier_limits["free"]
    return CreateKeyResponse(
        key=raw_key,
        label=key_row.label,
        email=key_row.email,
        tier=key_row.tier,
        monthly_limit=limit,
        created_at=key_row.created_at,
    )


@router.get("/keys/usage", response_model=KeyUsageResponse, summary="Get usage for current key")
async def get_usage(
    key_row: ApiKey = Depends(get_current_key),
):
    limit = settings.tier_limits.get(key_row.tier, settings.free_monthly_limit)
    return KeyUsageResponse(
        label=key_row.label,
        email=key_row.email,
        tier=key_row.tier,
        usage_count=key_row.usage_count,
        monthly_limit=limit,
        usage_reset_at=key_row.usage_reset_at,
        revoked=key_row.revoked,
    )


@router.delete("/keys/me", status_code=status.HTTP_204_NO_CONTENT, summary="Revoke current key")
async def revoke_key(
    key_row: ApiKey = Depends(get_current_key),
    db: AsyncSession = Depends(get_db),
):
    key_row.revoked = True
    await db.commit()
    return None


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def _next_reset(from_dt: datetime) -> datetime:
    if from_dt.month == 12:
        return from_dt.replace(year=from_dt.year + 1, month=1, day=1,
                               hour=0, minute=0, second=0, microsecond=0)
    return from_dt.replace(month=from_dt.month + 1, day=1,
                           hour=0, minute=0, second=0, microsecond=0)
