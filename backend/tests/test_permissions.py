import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.core.auth import AuthUser
from app.core.permissions import get_initiative_with_role
from app.models.initiative import Initiative


class _ScalarListResult:
    def __init__(self, items):
        self._items = list(items)

    def all(self):
        return list(self._items)


class _FakeResult:
    def __init__(self, *, scalar=None, scalars=None, rows=None):
        self._scalar = scalar
        self._scalars = [] if scalars is None else scalars
        self._rows = [] if rows is None else rows

    def scalar_one_or_none(self):
        return self._scalar

    def scalars(self):
        return _ScalarListResult(self._scalars)

    def all(self):
        return list(self._rows)


@pytest.mark.asyncio
async def test_slug_lookup_prefers_owned_initiative_when_slug_collides():
    user = AuthUser(uid="owner-1", email="owner@example.com")
    owned = Initiative(id=uuid.uuid4(), user_id=user.uid, slug="project-2")

    db = AsyncMock()
    db.execute.side_effect = [
        _FakeResult(scalars=[owned]),
        _FakeResult(rows=[]),
    ]

    initiative, role = await get_initiative_with_role(db, "project-2", user)

    assert initiative is owned
    assert role == "owner"


@pytest.mark.asyncio
async def test_slug_lookup_returns_shared_initiative_when_user_has_access():
    user = AuthUser(uid="viewer-1", email="viewer@example.com")
    shared = Initiative(id=uuid.uuid4(), user_id="owner-2", slug="project-2")

    db = AsyncMock()
    db.execute.side_effect = [
        _FakeResult(scalars=[]),
        _FakeResult(rows=[(shared, "viewer")]),
    ]

    initiative, role = await get_initiative_with_role(db, "project-2", user)

    assert initiative is shared
    assert role == "viewer"


@pytest.mark.asyncio
async def test_slug_lookup_raises_conflict_for_ambiguous_legacy_url():
    user = AuthUser(uid="viewer-1", email="viewer@example.com")
    shared_one = Initiative(id=uuid.uuid4(), user_id="owner-1", slug="project-2")
    shared_two = Initiative(id=uuid.uuid4(), user_id="owner-2", slug="project-2")

    db = AsyncMock()
    db.execute.side_effect = [
        _FakeResult(scalars=[]),
        _FakeResult(rows=[(shared_one, "viewer"), (shared_two, "editor")]),
    ]

    with pytest.raises(HTTPException) as exc_info:
        await get_initiative_with_role(db, "project-2", user)

    assert exc_info.value.status_code == 409
    assert "canonical URL" in exc_info.value.detail
