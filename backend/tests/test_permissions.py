import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.core.auth import AuthUser
from app.core.permissions import get_initiative_with_role
from app.models.initiative import Initiative


class _FakeResult:
    def __init__(self, *, scalar=None):
        self._scalar = scalar

    def scalar_one_or_none(self):
        return self._scalar

@pytest.mark.asyncio
async def test_uuid_lookup_returns_owned_initiative():
    user = AuthUser(uid="owner-1", email="owner@example.com")
    owned = Initiative(id=uuid.uuid4(), user_id=user.uid)

    db = AsyncMock()
    db.execute.side_effect = [_FakeResult(scalar=owned)]

    initiative, role = await get_initiative_with_role(db, str(owned.id), user)

    assert initiative is owned
    assert role == "owner"


@pytest.mark.asyncio
async def test_uuid_lookup_returns_shared_initiative_role():
    user = AuthUser(uid="viewer-1", email="viewer@example.com")
    shared = Initiative(id=uuid.uuid4(), user_id="owner-2")

    db = AsyncMock()
    db.execute.side_effect = [
        _FakeResult(scalar=shared),
        _FakeResult(scalar=SimpleNamespace(role="viewer")),
    ]

    initiative, role = await get_initiative_with_role(db, str(shared.id), user)

    assert initiative is shared
    assert role == "viewer"


@pytest.mark.asyncio
async def test_invalid_uuid_raises_not_found():
    user = AuthUser(uid="owner-1", email="owner@example.com")
    db = AsyncMock()

    with pytest.raises(HTTPException) as exc_info:
        await get_initiative_with_role(db, "project-2", user)

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Initiative not found"
