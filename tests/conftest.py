"""
Pytest fixtures shared across all tests.
- Uses an in-memory SQLite database (isolated per test session).
- Stubs out OpenAI calls so tests don't hit the real API.
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.db import database
from app.db.database import Base

# ── Override DB to use in-memory SQLite ──────────────────────────────────────
TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_test_db():
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

    engine = create_async_engine(TEST_DB_URL)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        from app.models import db as _models  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)

    # Monkey-patch the module-level engine/session so the app uses test DB
    database.engine = engine
    database.AsyncSessionLocal = session_factory
    yield
    await engine.dispose()


@pytest_asyncio.fixture
async def client():
    """HTTP test client wired to the FastAPI app."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
