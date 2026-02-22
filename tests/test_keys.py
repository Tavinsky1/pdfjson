"""
Tests for key creation and usage endpoints.
"""
import pytest
from httpx import AsyncClient
from app.core.config import settings


@pytest.mark.asyncio
async def test_create_key(client: AsyncClient):
    resp = await client.post("/keys", json={"email": "test@example.com", "label": "my key"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["key"].startswith("pdfa_")
    assert data["tier"] == "free"
    assert data["monthly_limit"] == settings.free_monthly_limit
    assert "key" in data  # raw key in response

    global _test_key
    _test_key = data["key"]


@pytest.mark.asyncio
async def test_get_usage(client: AsyncClient):
    # First create a key
    resp = await client.post("/keys", json={"email": "usage@example.com"})
    key = resp.json()["key"]

    # Check usage
    resp2 = await client.get("/keys/usage", headers={"Authorization": f"Bearer {key}"})
    assert resp2.status_code == 200
    data = resp2.json()
    assert data["usage_count"] == 0
    assert data["monthly_limit"] == settings.free_monthly_limit
    assert data["tier"] == "free"
    assert data["revoked"] is False


@pytest.mark.asyncio
async def test_invalid_key_returns_401(client: AsyncClient):
    resp = await client.get(
        "/keys/usage",
        headers={"Authorization": "Bearer pdfa_thisisnotvalid"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_key_missing_email(client: AsyncClient):
    resp = await client.post("/keys", json={"label": "no email"})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_revoke_key(client: AsyncClient):
    resp = await client.post("/keys", json={"email": "revoke@example.com"})
    key = resp.json()["key"]

    # Revoke
    resp2 = await client.delete("/keys/me", headers={"Authorization": f"Bearer {key}"})
    assert resp2.status_code == 204

    # Key should now return 403
    resp3 = await client.get("/keys/usage", headers={"Authorization": f"Bearer {key}"})
    assert resp3.status_code == 403
