import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import IntegrityError

from app.api import initiatives as initiatives_api
from app.core.auth import AuthUser
from app.main import app
from app.models.initiative import Initiative


class _FakeScalarResult:
    def __init__(self, items):
        self._items = list(items)

    def all(self):
        return list(self._items)


class _FakeExecuteResult:
    def __init__(self, items):
        self._items = list(items)

    def scalars(self):
        return _FakeScalarResult(self._items)


class _FakeInitiativeCreateDb:
    """Fake enough DB behavior to catch slug/constraint mismatches."""

    def __init__(self):
        self.added = []

    async def execute(self, statement, *_args, **_kwargs):
        statement_text = str(statement)
        if "initiatives.user_id" in statement_text:
            return _FakeExecuteResult(["project"])
        if "initiatives.workspace_id" in statement_text:
            return _FakeExecuteResult([])
        return _FakeExecuteResult([])

    def add(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()
        if isinstance(obj, Initiative):
            obj.sector = obj.sector or "general"
            obj.stage = obj.stage or "describe"
            obj.stage_1_complete = bool(obj.stage_1_complete)
            obj.evidence_ready = bool(obj.evidence_ready)
            obj.archived = bool(obj.archived)
        if getattr(obj, "created_at", None) is None:
            obj.created_at = datetime.now(timezone.utc)
        if getattr(obj, "updated_at", None) is None:
            obj.updated_at = datetime.now(timezone.utc)
        self.added.append(obj)

    async def commit(self):
        created = next((obj for obj in self.added if isinstance(obj, Initiative)), None)
        if created and created.slug == "project":
            raise IntegrityError(
                "insert initiative",
                {},
                Exception('duplicate key value violates unique constraint "ix_initiatives_user_id_slug"'),
            )

    async def refresh(self, _obj):
        return None

    async def get(self, _model, _id):
        return SimpleNamespace(email="owner@example.com")


@pytest.mark.asyncio
async def test_create_initiative_uses_user_scoped_slug_for_cross_workspace_duplicates(
    monkeypatch: pytest.MonkeyPatch,
):
    """Creating a blank project in another workspace must not reuse a user's existing slug."""
    fake_db = _FakeInitiativeCreateDb()
    user = AuthUser(uid="user-1", email="owner@example.com")
    team_workspace = SimpleNamespace(id=uuid.uuid4())

    async def override_db():
        yield fake_db

    async def override_user():
        return user

    async def fake_ensure_user_exists(_db, _user):
        return None

    async def fake_resolve_workspace_for_user(_db, _user_id, workspace_id):
        assert workspace_id == team_workspace.id
        return team_workspace, SimpleNamespace(role="owner")

    def fake_initiative_to_response(initiative, *, shared_role=None, owner_email=None):
        return {
            "id": initiative.id,
            "slug": initiative.slug,
            "user_id": initiative.user_id,
            "workspace_id": initiative.workspace_id,
            "title": initiative.title,
            "icon": initiative.icon,
            "sector": initiative.sector,
            "geography": initiative.geography,
            "target_population": initiative.target_population,
            "goal": initiative.goal,
            "budget_range": initiative.budget_range,
            "timeline": initiative.timeline,
            "constraints": initiative.constraints,
            "stage": initiative.stage,
            "stage_1_complete": initiative.stage_1_complete,
            "evidence_ready": initiative.evidence_ready,
            "archived": initiative.archived,
            "created_at": initiative.created_at,
            "updated_at": initiative.updated_at,
            "project_description": initiative.project_description,
            "project_type": initiative.project_type,
            "overview_description": initiative.overview_description,
            "overview_generated_at": initiative.overview_generated_at,
            "selected_tools": initiative.selected_tools,
            "tool_inputs": None,
            "module_alignments": None,
            "deliverables": None,
            "project_plan": None,
            "module_instances": [],
            "module_instances_count": 0,
            "generated_modules_count": 0,
            "shared_role": shared_role,
            "owner_email": owner_email,
        }

    app.dependency_overrides[initiatives_api.get_db] = override_db
    app.dependency_overrides[initiatives_api.get_current_user] = override_user
    monkeypatch.setattr(initiatives_api, "ensure_user_exists", fake_ensure_user_exists)
    monkeypatch.setattr(initiatives_api, "resolve_workspace_for_user", fake_resolve_workspace_for_user)
    monkeypatch.setattr(initiatives_api, "_initiative_to_response", fake_initiative_to_response)

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
        ) as client:
            response = await client.post(
                "/api/v1/initiatives",
                json={"workspace_id": str(team_workspace.id)},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    assert response.json()["slug"] == "project-2"
