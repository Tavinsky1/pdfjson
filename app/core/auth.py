import secrets
import hashlib
from datetime import datetime, timezone, timedelta

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import get_db
from app.models.db import ApiKey

security = HTTPBearer()


def generate_api_key() -> tuple[str, str]:
    """
    Returns (raw_key, hashed_key).
    raw_key is shown to the user ONCE. hashed_key is stored in DB.
    """
    raw = settings.api_key_prefix + secrets.token_urlsafe(32)
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    return raw, hashed


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def get_current_key(
    credentials: HTTPAuthorizationCredentials = Security(security),
    db: AsyncSession = Depends(get_db),
) -> ApiKey:
    """
    FastAPI dependency — validates Bearer key and returns the ApiKey row.
    Raises 401 if missing/invalid, 402 if over limit, 403 if revoked.
    """
    from sqlalchemy import select

    token = credentials.credentials
    hashed = hash_key(token)

    result = await db.execute(select(ApiKey).where(ApiKey.key_hash == hashed))
    key_row: ApiKey | None = result.scalar_one_or_none()

    if key_row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key.",
        )

    if key_row.revoked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This API key has been revoked.",
        )

    # Reset monthly usage counter if a new billing month has started
    now = datetime.now(timezone.utc)
    reset_at = key_row.usage_reset_at
    # SQLite stores datetimes as naive; normalise for comparison
    if reset_at is not None and reset_at.tzinfo is None:
        reset_at = reset_at.replace(tzinfo=timezone.utc)
    if reset_at is None or now >= reset_at:
        key_row.usage_count = 0
        key_row.usage_reset_at = _next_reset(now)
        await db.commit()

    limit = settings.tier_limits.get(key_row.tier, settings.free_monthly_limit)
    if key_row.usage_count >= limit:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Monthly limit of {limit} parses reached for the '{key_row.tier}' tier. "
                "Upgrade at https://pdfapi.dev/billing"
            ),
        )

    return key_row


def _next_reset(from_dt: datetime) -> datetime:
    """First day of next calendar month at 00:00 UTC."""
    if from_dt.month == 12:
        return from_dt.replace(year=from_dt.year + 1, month=1, day=1,
                               hour=0, minute=0, second=0, microsecond=0)
    return from_dt.replace(month=from_dt.month + 1, day=1,
                           hour=0, minute=0, second=0, microsecond=0)
