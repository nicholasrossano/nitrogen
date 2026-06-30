import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.api import projects as projects_api
from app.core.auth import AuthUser
from app.models.project import Project
from app.models.workspace import WorkspaceType
from tests.api.conftest import FakeExecuteResult


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


@pytest.mark.asyncio
async def test_list_projects_returns_workspace_rows_without_per_row_permission_filter(
    monkeypatch: pytest.MonkeyPatch,
):
    """Regression: list_projects must not silently drop every row after the initiatives port."""
    workspace_id = uuid.uuid4()
    project = Project(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        name="Core Deal",
        slug="core-deal",
        created_by="firebase-user-1",
        archived=False,
        sector="general",
        stage="describe",
        stage_1_complete=False,
        evidence_ready=False,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    workspace = SimpleNamespace(
        id=workspace_id,
        workspace_type=WorkspaceType.TEAM.value,
    )
    membership = SimpleNamespace(role="owner")

    async def fake_ensure_user_exists(_db, _user):
        return None

    async def fake_resolve_workspace_for_user(_db, _uid, _workspace_id):
        return workspace, membership

    async def fake_execute(statement, *_args, **_kwargs):
        statement_text = str(statement)
        if "project_shares" in statement_text:
            return _FakeExecuteResult([])
        if "FROM projects" in statement_text:
            return _FakeExecuteResult([project])
        return _FakeExecuteResult([])

    async def fake_get(_model, _id):
        return SimpleNamespace(email="owner@example.com")

    db = SimpleNamespace(execute=fake_execute, get=fake_get)
    user = AuthUser(uid="firebase-user-1", email="owner@example.com")

    monkeypatch.setattr(projects_api, "ensure_user_exists", fake_ensure_user_exists)
    monkeypatch.setattr(projects_api, "resolve_workspace_for_user", fake_resolve_workspace_for_user)

    rows = await projects_api.list_projects(
        limit=100,
        offset=0,
        archived=False,
        workspace_id=str(workspace_id),
        db=db,
        user=user,
    )

    assert len(rows) == 1
    assert rows[0]["title"] == "Core Deal"
    assert str(rows[0]["id"]) == str(project.id)


@pytest.mark.asyncio
async def test_list_projects_http_returns_workspace_rows(
    api_client,
    override_db,
    auth_user_override,
    monkeypatch: pytest.MonkeyPatch,
):
    workspace_id = uuid.uuid4()
    project = Project(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        name="Core Deal",
        slug="core-deal",
        created_by="firebase-user-1",
        archived=False,
        sector="general",
        stage="describe",
        stage_1_complete=False,
        evidence_ready=False,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    workspace = SimpleNamespace(
        id=workspace_id,
        workspace_type=WorkspaceType.TEAM.value,
    )
    membership = SimpleNamespace(role="owner")

    async def fake_ensure_user_exists(_db, _user):
        return None

    async def fake_resolve_workspace_for_user(_db, _uid, _workspace_id):
        return workspace, membership

    def execute_handler(statement):
        statement_text = str(statement)
        if "project_shares" in statement_text:
            return FakeExecuteResult([])
        if "FROM projects" in statement_text:
            return FakeExecuteResult([project])
        return FakeExecuteResult([])

    async def fake_get(_model, _id):
        return SimpleNamespace(email="owner@example.com")

    fake_db = override_db(execute_handler=execute_handler)
    fake_db.get = fake_get
    auth_user_override(AuthUser(uid="firebase-user-1", email="owner@example.com"))

    monkeypatch.setattr(projects_api, "ensure_user_exists", fake_ensure_user_exists)
    monkeypatch.setattr(projects_api, "resolve_workspace_for_user", fake_resolve_workspace_for_user)

    response = await api_client.get(
        "/api/v1/projects",
        params={"workspace_id": str(workspace_id), "limit": 100, "offset": 0},
    )

    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["title"] == "Core Deal"
    assert rows[0]["id"] == str(project.id)


@pytest.mark.asyncio
async def test_create_project_http_returns_201(
    api_client,
    override_db,
    auth_user_override,
    monkeypatch: pytest.MonkeyPatch,
):
    workspace_id = uuid.uuid4()
    team_workspace = SimpleNamespace(id=workspace_id)

    async def fake_ensure_user_exists(_db, _user):
        return None

    async def fake_resolve_workspace_for_user(_db, _user_id, requested_workspace_id):
        assert requested_workspace_id == workspace_id
        return team_workspace, SimpleNamespace(role="owner")

    def execute_handler(statement):
        statement_text = str(statement)
        if "projects.slug" in statement_text or "projects.created_by" in statement_text:
            return FakeExecuteResult([])
        return FakeExecuteResult([])

    fake_db = override_db(execute_handler=execute_handler)
    auth_user_override(AuthUser(uid="user-1", email="owner@example.com"))

    async def fake_get(_model, _id):
        return SimpleNamespace(email="owner@example.com")

    fake_db.get = fake_get

    monkeypatch.setattr(projects_api, "ensure_user_exists", fake_ensure_user_exists)
    monkeypatch.setattr(projects_api, "resolve_workspace_for_user", fake_resolve_workspace_for_user)

    response = await api_client.post(
        "/api/v1/projects",
        json={"workspace_id": str(workspace_id), "title": "New Deal"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "New Deal"
    assert body["slug"] == "new-deal"
    assert body["workspace_id"] == str(workspace_id)
    assert len(fake_db.added) == 1
    assert isinstance(fake_db.added[0], Project)
