"""
Tests for API endpoints.
"""
import uuid
import pytest
import pytest_asyncio
from unittest.mock import patch, AsyncMock, MagicMock
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.core.database import get_db
from app.core.auth import get_current_user, MockUser
from app.models.initiative import Initiative, InitiativeStage


# Override dependencies for testing
async def override_get_db():
    """Override database dependency for testing."""
    # This will be replaced in fixtures
    pass


async def override_get_current_user():
    """Override auth dependency for testing."""
    return MockUser(uid="test-user-001")


class TestRootEndpoints:
    """Tests for root endpoints."""

    @pytest.mark.asyncio
    async def test_root_endpoint(self):
        """Test the root endpoint returns API info."""
        app.dependency_overrides[get_current_user] = override_get_current_user
        
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


class TestInitiativesAPI:
    """Tests for initiatives API endpoints."""

    @pytest.mark.asyncio
    async def test_create_initiative(self, db_session: AsyncSession, mock_user: MockUser):
        """Test creating a new initiative."""
        # Setup dependency overrides
        async def get_test_db():
            yield db_session
        
        app.dependency_overrides[get_db] = get_test_db
        app.dependency_overrides[get_current_user] = lambda: mock_user
        
        try:
            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://test"
            ) as client:
                response = await client.post(
                    "/api/v1/initiatives",
                    json={"title": "Test Initiative"}
                )
            
            assert response.status_code == 201
            data = response.json()
            assert "id" in data
            assert data["title"] == "Test Initiative"
            assert data["stage"] == "describe"
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_create_initiative_no_title(self, db_session: AsyncSession, mock_user: MockUser):
        """Test creating an initiative without a title."""
        async def get_test_db():
            yield db_session
        
        app.dependency_overrides[get_db] = get_test_db
        app.dependency_overrides[get_current_user] = lambda: mock_user
        
        try:
            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://test"
            ) as client:
                response = await client.post(
                    "/api/v1/initiatives",
                    json={}
                )
            
            assert response.status_code == 201
            data = response.json()
            assert data["title"] is None
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_get_initiative(
        self, 
        db_session: AsyncSession, 
        sample_initiative: Initiative,
        mock_user: MockUser
    ):
        """Test getting an initiative by ID."""
        async def get_test_db():
            yield db_session
        
        app.dependency_overrides[get_db] = get_test_db
        app.dependency_overrides[get_current_user] = lambda: mock_user
        
        try:
            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://test"
            ) as client:
                response = await client.get(
                    f"/api/v1/initiatives/{sample_initiative.id}"
                )
            
            assert response.status_code == 200
            data = response.json()
            assert data["id"] == str(sample_initiative.id)
            assert data["title"] == sample_initiative.title
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_get_initiative_not_found(
        self, 
        db_session: AsyncSession,
        mock_user: MockUser
    ):
        """Test getting a non-existent initiative."""
        async def get_test_db():
            yield db_session
        
        app.dependency_overrides[get_db] = get_test_db
        app.dependency_overrides[get_current_user] = lambda: mock_user
        
        try:
            fake_id = uuid.uuid4()
            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://test"
            ) as client:
                response = await client.get(f"/api/v1/initiatives/{fake_id}")
            
            assert response.status_code == 404
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_get_initiative_wrong_user(
        self, 
        db_session: AsyncSession, 
        sample_initiative: Initiative,
        another_user: MockUser
    ):
        """Test that users can't access other users' initiatives."""
        async def get_test_db():
            yield db_session
        
        app.dependency_overrides[get_db] = get_test_db
        app.dependency_overrides[get_current_user] = lambda: another_user
        
        try:
            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://test"
            ) as client:
                response = await client.get(
                    f"/api/v1/initiatives/{sample_initiative.id}"
                )
            
            # Should return 404 (not found) for unauthorized user
            assert response.status_code == 404
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_list_initiatives(
        self, 
        db_session: AsyncSession, 
        sample_initiative: Initiative,
        mock_user: MockUser
    ):
        """Test listing user's initiatives."""
        async def get_test_db():
            yield db_session
        
        app.dependency_overrides[get_db] = get_test_db
        app.dependency_overrides[get_current_user] = lambda: mock_user
        
        try:
            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://test"
            ) as client:
                response = await client.get("/api/v1/initiatives")
            
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            assert len(data) >= 1
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_list_initiatives_pagination(
        self, 
        db_session: AsyncSession,
        mock_user: MockUser
    ):
        """Test initiatives list pagination."""
        # Create multiple initiatives
        for i in range(5):
            initiative = Initiative(
                user_id=mock_user.uid,
                title=f"Initiative {i}",
            )
            db_session.add(initiative)
        await db_session.commit()
        
        async def get_test_db():
            yield db_session
        
        app.dependency_overrides[get_db] = get_test_db
        app.dependency_overrides[get_current_user] = lambda: mock_user
        
        try:
            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://test"
            ) as client:
                response = await client.get(
                    "/api/v1/initiatives?limit=2&offset=0"
                )
            
            assert response.status_code == 200
            data = response.json()
            assert len(data) == 2
        finally:
            app.dependency_overrides.clear()


class TestChatAPI:
    """Tests for chat API endpoints."""

    @pytest.mark.asyncio
    async def test_get_chat_history(
        self, 
        db_session: AsyncSession, 
        sample_initiative: Initiative,
        mock_user: MockUser
    ):
        """Test getting chat history for an initiative."""
        async def get_test_db():
            yield db_session
        
        app.dependency_overrides[get_db] = get_test_db
        app.dependency_overrides[get_current_user] = lambda: mock_user
        
        try:
            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://test"
            ) as client:
                response = await client.get(
                    f"/api/v1/initiatives/{sample_initiative.id}/chat"
                )
            
            assert response.status_code == 200
            data = response.json()
            assert "messages" in data
            assert "stage_status" in data
            # Should have at least the initial greeting
            assert len(data["messages"]) >= 1
        finally:
            app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_get_chat_history_not_found(
        self, 
        db_session: AsyncSession,
        mock_user: MockUser
    ):
        """Test getting chat history for non-existent initiative."""
        async def get_test_db():
            yield db_session
        
        app.dependency_overrides[get_db] = get_test_db
        app.dependency_overrides[get_current_user] = lambda: mock_user
        
        try:
            fake_id = uuid.uuid4()
            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://test"
            ) as client:
                response = await client.get(
                    f"/api/v1/initiatives/{fake_id}/chat"
                )
            
            assert response.status_code == 404
        finally:
            app.dependency_overrides.clear()


class TestAuthMiddleware:
    """Tests for authentication handling."""

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
