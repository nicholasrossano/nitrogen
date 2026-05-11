import pytest
from fastapi import HTTPException

from app.core import auth as auth_module


@pytest.mark.asyncio
async def test_dev_bypass_token_allowed_when_firebase_unconfigured(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(auth_module.settings, "debug", True)
    monkeypatch.setattr(auth_module.settings, "firebase_project_id", "")

    user = await auth_module.authenticate_bearer_token(auth_module.DEV_AUTH_BYPASS_TOKEN)

    assert user.uid == auth_module.DEV_AUTH_BYPASS_UID
    assert user.email == auth_module.DEV_AUTH_BYPASS_EMAIL


@pytest.mark.asyncio
async def test_dev_bypass_token_rejected_outside_debug(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(auth_module.settings, "debug", False)
    monkeypatch.setattr(auth_module.settings, "firebase_project_id", "")

    with pytest.raises(HTTPException) as exc_info:
        await auth_module.authenticate_bearer_token(auth_module.DEV_AUTH_BYPASS_TOKEN)

    assert exc_info.value.status_code == 503
