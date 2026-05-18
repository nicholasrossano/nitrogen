import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.core.auth import authenticate_bearer_token, get_current_user, shared_dev_user
from app.config import get_settings


@pytest.fixture(autouse=True)
def clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_no_firebase_project_uses_shared_dev_user(monkeypatch):
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "")
    monkeypatch.setenv("DEBUG", "true")
    get_settings.cache_clear()

    user = await get_current_user(None)
    assert user.uid == shared_dev_user().uid


@pytest.mark.asyncio
async def test_dev_mock_token_accepted_when_debug(monkeypatch):
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "test-project")
    monkeypatch.setenv("DEBUG", "true")
    monkeypatch.setenv("DEV_MOCK_TOKEN", "test-mock-token")
    get_settings.cache_clear()

    user = await authenticate_bearer_token("test-mock-token")
    assert user.uid == shared_dev_user().uid


@pytest.mark.asyncio
async def test_dev_mock_token_rejected_when_not_debug(monkeypatch):
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "test-project")
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.setenv("DEV_MOCK_TOKEN", "test-mock-token")
    get_settings.cache_clear()

    with pytest.raises(HTTPException) as exc:
        await authenticate_bearer_token("test-mock-token")
    assert exc.value.status_code in (401, 503)


@pytest.mark.asyncio
async def test_missing_credentials_requires_auth_when_firebase_configured(monkeypatch):
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "test-project")
    monkeypatch.setenv("DEBUG", "true")
    get_settings.cache_clear()

    with pytest.raises(HTTPException) as exc:
        await get_current_user(None)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_accepts_mock_bearer(monkeypatch):
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "test-project")
    monkeypatch.setenv("DEBUG", "true")
    monkeypatch.setenv("DEV_MOCK_TOKEN", "test-mock-token")
    get_settings.cache_clear()

    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="test-mock-token")
    user = await get_current_user(creds)
    assert user.uid == shared_dev_user().uid
