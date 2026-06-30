import uuid
from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.auth import AuthUser, get_current_user
from app.core.database import get_db
from app.main import app


class FakeScalarResult:
    def __init__(self, items):
        self._items = list(items)

    def all(self):
        return list(self._items)

    def scalar_one_or_none(self):
        return self._items[0] if self._items else None


class FakeExecuteResult:
    def __init__(self, items):
        self._items = list(items)

    def scalars(self):
        return FakeScalarResult(self._items)

    def all(self):
        return list(self._items)

    def scalar_one_or_none(self):
        return self._items[0] if self._items else None


class FakeDbSession:
    """Minimal async SQLAlchemy session stand-in for API route tests."""

    def __init__(self, *, get_map=None, execute_handler=None):
        self.added = []
        self.get_map = dict(get_map or {})
        self.execute_handler = execute_handler

    def add(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()
        if getattr(obj, "created_at", None) is None:
            obj.created_at = datetime.now(timezone.utc)
        if getattr(obj, "updated_at", None) is None:
            obj.updated_at = datetime.now(timezone.utc)
        model_name = obj.__class__.__name__
        if model_name == "Project":
            obj.sector = obj.sector or "general"
            obj.stage = obj.stage or "describe"
            obj.stage_1_complete = bool(getattr(obj, "stage_1_complete", False))
            obj.evidence_ready = bool(getattr(obj, "evidence_ready", False))
            obj.archived = bool(getattr(obj, "archived", False))
        if model_name == "Finding" and getattr(obj, "status", None) is None:
            obj.status = "published"
        self.added.append(obj)

    async def flush(self):
        return None

    async def commit(self):
        return None

    async def rollback(self):
        return None

    async def refresh(self, obj):
        if getattr(obj, "updated_at", None) is None:
            obj.updated_at = datetime.now(timezone.utc)
        return None

    async def delete(self, _obj):
        return None

    async def execute(self, statement, *_args, **_kwargs):
        if self.execute_handler is not None:
            return self.execute_handler(statement)
        return FakeExecuteResult([])

    async def scalar(self, _query):
        return 0

    async def get(self, model, obj_id):
        model_name = getattr(model, "__name__", str(model))
        return self.get_map.get((model_name, obj_id), self.get_map.get(obj_id))


@pytest.fixture
def fake_db_session():
    def _factory(**kwargs):
        return FakeDbSession(**kwargs)

    return _factory


@pytest.fixture
def override_db(fake_db_session):
    def _override(db=None, **kwargs):
        session = db or fake_db_session(**kwargs)

        async def db_override():
            yield session

        app.dependency_overrides[get_db] = db_override
        return session

    return _override


@pytest.fixture
def auth_user_override():
    def _override(user=None):
        auth_user = user or AuthUser(uid="user-1", email="test@example.com")

        async def override_user():
            return auth_user

        app.dependency_overrides[get_current_user] = override_user
        return auth_user

    return _override


@pytest.fixture
async def api_client():
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        yield client


@pytest.fixture(autouse=True)
def _clear_dependency_overrides():
    yield
    app.dependency_overrides.clear()
