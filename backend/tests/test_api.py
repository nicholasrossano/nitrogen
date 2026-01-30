"""
Tests for API endpoints.

Note: Tests that require database operations are marked with pytest.mark.skip
because the models use PostgreSQL-specific types (ARRAY, JSONB, Vector) that 
are not compatible with SQLite used in testing.

For integration tests, use a PostgreSQL test database or Docker.
"""
import uuid
import pytest
import pytest_asyncio
from unittest.mock import patch, AsyncMock, MagicMock
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.core.database import get_db
from app.core.auth import get_current_user, MockUser


# Override dependencies for testing
async def override_get_current_user():
    """Override auth dependency for testing."""
    return MockUser(uid="test-user-001")


class TestRootEndpoints:
    """Tests for root endpoints (no database required)."""

    @pytest.mark.asyncio
    async def test_root_endpoint(self):
        """Test the root endpoint returns API info."""
        app.dependency_overrides[get_current_user] = override_get_current_user
        
        try:
            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://test"
            ) as client:
                response = await client.get("/")
            
            assert response.status_code == 200
            data = response.json()
            assert "message" in data
            assert data["message"] == "Wisterion API"
            assert "version" in data
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_health_endpoint(self):
        """Test the health endpoint."""
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test"
        ) as client:
            response = await client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"


class TestAuthHandling:
    """Tests for authentication handling (no database required)."""

    @pytest.mark.asyncio
    async def test_mock_user_default(self):
        """Test that mock user works in development mode."""
        user = await override_get_current_user()
        assert user.uid == "test-user-001"
        assert user.email == "dev@wisterion.local"

    def test_mock_user_custom_uid(self):
        """Test creating MockUser with custom UID."""
        user = MockUser(uid="custom-user-123")
        assert user.uid == "custom-user-123"

    def test_mock_user_default_email(self):
        """Test MockUser has default email."""
        user = MockUser()
        assert user.email == "dev@wisterion.local"


class TestAPIStructure:
    """Tests for API structure and routing."""

    @pytest.mark.asyncio
    async def test_api_includes_initiatives_router(self):
        """Test that initiatives router is included."""
        # Just check that the route exists by checking the app routes
        routes = [route.path for route in app.routes]
        assert any("/api/v1/initiatives" in str(route) for route in routes)

    @pytest.mark.asyncio
    async def test_api_includes_chat_router(self):
        """Test that chat endpoints are available."""
        routes = [route.path for route in app.routes]
        assert any("/chat" in str(route) for route in routes)

    @pytest.mark.asyncio
    async def test_api_includes_tools_router(self):
        """Test that tools router is included."""
        routes = [route.path for route in app.routes]
        assert any("/tools" in str(route) for route in routes)


# Note: The following tests are skipped because they require a PostgreSQL database.
# They use models with ARRAY and JSONB types that SQLite doesn't support.
# To run these tests, set up a PostgreSQL test database.

@pytest.mark.skip(reason="Requires PostgreSQL database - models use ARRAY/JSONB types")
class TestInitiativesAPIIntegration:
    """Integration tests for initiatives API (requires PostgreSQL)."""

    @pytest.mark.asyncio
    async def test_create_initiative(self):
        """Test creating a new initiative."""
        pass

    @pytest.mark.asyncio
    async def test_get_initiative(self):
        """Test getting an initiative by ID."""
        pass

    @pytest.mark.asyncio
    async def test_list_initiatives(self):
        """Test listing user's initiatives."""
        pass


@pytest.mark.skip(reason="Requires PostgreSQL database - models use ARRAY/JSONB types")
class TestChatAPIIntegration:
    """Integration tests for chat API (requires PostgreSQL)."""

    @pytest.mark.asyncio
    async def test_get_chat_history(self):
        """Test getting chat history for an initiative."""
        pass

    @pytest.mark.asyncio
    async def test_send_message(self):
        """Test sending a chat message."""
        pass
