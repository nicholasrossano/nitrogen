"""
Minimal smoke tests to verify FastAPI app boots correctly.
"""
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.mark.asyncio
async def test_app_boots_openapi():
    """Smoke test: verify FastAPI app boots and serves OpenAPI spec"""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/openapi.json")
        assert response.status_code == 200
        data = response.json()
        assert "openapi" in data
        assert "info" in data
        assert data["info"]["title"] == "Nitrogen API"


@pytest.mark.asyncio
async def test_health_endpoint():
    """Smoke test: verify health endpoint responds correctly"""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "healthy"}
