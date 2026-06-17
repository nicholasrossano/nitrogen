import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.core.auth import authenticate_bearer_token, get_current_user
from app.config import get_settings


@pytest.fixture(autouse=True)
def clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_missing_firebase_project_returns_503(monkeypatch):
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "")
    get_settings.cache_clear()

    with pytest.raises(HTTPException) as exc:
        await get_current_user(None)
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_missing_credentials_returns_401(monkeypatch):
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "test-project")
    get_settings.cache_clear()

    with pytest.raises(HTTPException) as exc:
        await get_current_user(None)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_dev_mock_token_rejected(monkeypatch):
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "test-project")
    monkeypatch.setenv("DEBUG", "true")
    get_settings.cache_clear()

    with pytest.raises(HTTPException) as exc:
        await authenticate_bearer_token("dev-mock-token")
    assert exc.value.status_code in (401, 503)


@pytest.mark.asyncio
async def test_get_current_user_requires_bearer(monkeypatch):
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "test-project")
    get_settings.cache_clear()

    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="not-a-real-token")
    with pytest.raises(HTTPException) as exc:
        await get_current_user(creds)
    assert exc.value.status_code in (401, 503)
