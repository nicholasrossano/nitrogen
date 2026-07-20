import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import users as users_api
from app.core.auth import AuthUser


class _FakeScalarResult:
    def __init__(self, items):
        self._items = list(items)

    def all(self):
        return list(self._items)

    def scalar_one_or_none(self):
        return self._items[0] if self._items else None


class _FakeExecuteResult:
    def __init__(self, items):
        self._items = list(items)

    def scalars(self):
        return _FakeScalarResult(self._items)

    def all(self):
        return list(self._items)

    def scalar_one_or_none(self):
        return self._items[0] if self._items else None


class _FakeDb:
    """Async-session stand-in with per-table query routing and delete tracking.

    ``scalar_queue`` values are consumed in FIFO call order — bind parameters
    (like a workspace id) don't appear as literals in ``str(statement)``, so
    matching by call order is simpler than trying to parse them out.
    """

    def __init__(self, *, table_rows=None, scalar_queue=None, get_map=None):
        self.table_rows = table_rows or {}
        self.scalar_queue = list(scalar_queue or [])
        self.get_map = get_map or {}
        self.deleted = []
        self.executed = []
        self.committed = False

    async def execute(self, statement, *_args, **_kwargs):
        self.executed.append(statement)
        text = str(statement)
        for marker, rows in self.table_rows.items():
            if marker in text:
                return _FakeExecuteResult(rows)
        return _FakeExecuteResult([])

    async def scalar(self, _statement):
        if self.scalar_queue:
            return self.scalar_queue.pop(0)
        return 0

    async def get(self, model, obj_id):
        return self.get_map.get(obj_id)

    async def delete(self, obj):
        self.deleted.append(obj)

    async def commit(self):
        self.committed = True


def _team_workspace(name="Acme Team", ws_id=None):
    return SimpleNamespace(
        id=ws_id or uuid.uuid4(),
        name=name,
        workspace_type="team",
    )


@pytest.mark.asyncio
async def test_blockers_flags_team_workspace_with_other_members():
    workspace = _team_workspace()
    db = _FakeDb(
        table_rows={
            "workspace_memberships": [workspace],
        },
        scalar_queue=[2],
    )

    blockers = await users_api._account_deletion_blockers(db, "user-1")

    assert len(blockers) == 1
    assert "Acme Team" in blockers[0]
    assert "2 other members" in blockers[0]


@pytest.mark.asyncio
async def test_blockers_flags_shared_project():
    db = _FakeDb(
        table_rows={
            "project_shares": [("Solar Deal", 1)],
        },
    )

    blockers = await users_api._account_deletion_blockers(db, "user-1")

    assert len(blockers) == 1
    assert "Solar Deal" in blockers[0]
    assert "1 collaborator" in blockers[0]


@pytest.mark.asyncio
async def test_blockers_empty_when_nothing_shared():
    db = _FakeDb()

    blockers = await users_api._account_deletion_blockers(db, "user-1")

    assert blockers == []


@pytest.mark.asyncio
async def test_delete_my_account_raises_409_when_blocked(monkeypatch: pytest.MonkeyPatch):
    async def fake_ensure_user_exists(_db, _user):
        return None

    async def fake_blockers(_db, _uid):
        return ['project "Solar Deal" (1 collaborator)']

    monkeypatch.setattr(users_api, "ensure_user_exists", fake_ensure_user_exists)
    monkeypatch.setattr(users_api, "_account_deletion_blockers", fake_blockers)

    db = _FakeDb()
    user = AuthUser(uid="user-1", email="owner@example.com")

    with pytest.raises(HTTPException) as exc_info:
        await users_api.delete_my_account(db=db, user=user)

    assert exc_info.value.status_code == 409
    assert "Solar Deal" in exc_info.value.detail
    assert db.deleted == []
    assert db.committed is False


@pytest.mark.asyncio
async def test_delete_my_account_deletes_owned_data_when_unblocked(monkeypatch: pytest.MonkeyPatch):
    async def fake_ensure_user_exists(_db, _user):
        return None

    async def fake_blockers(_db, _uid):
        return []

    cancel_calls: list[str] = []

    async def fake_cancel_subscription(user_id, _db):
        cancel_calls.append(user_id)

    monkeypatch.setattr(users_api, "ensure_user_exists", fake_ensure_user_exists)
    monkeypatch.setattr(users_api, "_account_deletion_blockers", fake_blockers)
    monkeypatch.setattr(users_api, "cancel_active_subscription", fake_cancel_subscription)
    monkeypatch.setattr(users_api, "_init_firebase", lambda: False)

    project_id = uuid.uuid4()
    db_user = SimpleNamespace(id="user-1")

    db = _FakeDb(
        table_rows={
            # Project.id lookup for cleanup paths; workspace join returns empty.
            "projects.id": [project_id],
        },
        get_map={"user-1": db_user},
    )
    user = AuthUser(uid="user-1", email="owner@example.com")

    result = await users_api.delete_my_account(db=db, user=user)

    assert result is None
    assert cancel_calls == ["user-1"]
    assert db_user in db.deleted
    assert db.committed is True
    executed_sql = [str(stmt) for stmt in db.executed]
    assert any("projects" in sql.lower() for sql in executed_sql)
    assert any("core_chats" in sql.lower() for sql in executed_sql)
