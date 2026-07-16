"""API tests for project variable comments."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.api import variables as variables_api
from app.models.variable import Variable, VariableComment


def _make_variable(*, project_id: uuid.UUID | None = None) -> Variable:
    return Variable(
        id=uuid.uuid4(),
        project_id=project_id or uuid.uuid4(),
        key="tilt",
        label="Tilt Angle",
        value=None,
        unit="°",
        value_type="number",
        source_type="manual",
        status="assumed",
        used_in_assessments=[],
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


@pytest.mark.asyncio
async def test_list_variable_comments_returns_empty_list(
    api_client,
    override_db,
    auth_user_override,
    monkeypatch: pytest.MonkeyPatch,
):
    variable = _make_variable()
    auth_user_override()
    override_db()

    async def fake_get_variable(_db, variable_id):
        assert variable_id == variable.id
        return variable

    async def fake_require_project_viewer(_db, project_id, _user):
        assert project_id == variable.project_id
        return SimpleNamespace(id=project_id, touch=lambda: None)

    async def fake_list_comments(_db, variable_id):
        assert variable_id == variable.id
        return []

    monkeypatch.setattr(variables_api, "get_variable", fake_get_variable)
    monkeypatch.setattr(variables_api, "require_project_viewer", fake_require_project_viewer)
    monkeypatch.setattr(variables_api, "list_variable_comments", fake_list_comments)

    response = await api_client.get(f"/api/v1/variables/{variable.id}/comments")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_list_variable_comments_returns_404_when_missing(
    api_client,
    override_db,
    auth_user_override,
    monkeypatch: pytest.MonkeyPatch,
):
    auth_user_override()
    override_db()
    missing_id = uuid.uuid4()

    async def fake_get_variable(_db, _variable_id):
        return None

    monkeypatch.setattr(variables_api, "get_variable", fake_get_variable)

    response = await api_client.get(f"/api/v1/variables/{missing_id}/comments")
    assert response.status_code == 404
    assert response.json()["detail"] == "Variable not found"


@pytest.mark.asyncio
async def test_create_variable_comment_returns_201(
    api_client,
    override_db,
    auth_user_override,
    monkeypatch: pytest.MonkeyPatch,
):
    variable = _make_variable()
    auth_user_override()
    override_db()
    created = VariableComment(
        id=uuid.uuid4(),
        variable_id=variable.id,
        project_id=variable.project_id,
        body="Looks right",
        created_by_user_id="user-1",
        created_by_email="test@example.com",
        created_at=datetime.now(timezone.utc),
    )

    async def fake_get_variable(_db, variable_id):
        assert variable_id == variable.id
        return variable

    async def fake_require_project_editor(_db, project_id, _user):
        assert project_id == variable.project_id
        return SimpleNamespace(id=project_id, touch=lambda: None)

    async def fake_create_comment(_db, got_variable, *, body, actor):
        assert got_variable.id == variable.id
        assert body == "Looks right"
        assert actor.user_id == "user-1"
        return created

    monkeypatch.setattr(variables_api, "get_variable", fake_get_variable)
    monkeypatch.setattr(variables_api, "require_project_editor", fake_require_project_editor)
    monkeypatch.setattr(variables_api, "create_variable_comment", fake_create_comment)

    response = await api_client.post(
        f"/api/v1/variables/{variable.id}/comments",
        json={"body": "Looks right"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["id"] == str(created.id)
    assert body["variable_id"] == str(variable.id)
    assert body["body"] == "Looks right"
    assert body["created_by_email"] == "test@example.com"


@pytest.mark.asyncio
async def test_legacy_assumptions_comments_alias_still_works(
    api_client,
    override_db,
    auth_user_override,
    monkeypatch: pytest.MonkeyPatch,
):
    variable = _make_variable()
    auth_user_override()
    override_db()

    async def fake_get_variable(_db, variable_id):
        assert variable_id == variable.id
        return variable

    async def fake_require_project_viewer(_db, project_id, _user):
        return SimpleNamespace(id=project_id, touch=lambda: None)

    async def fake_list_comments(_db, variable_id):
        return []

    monkeypatch.setattr(variables_api, "get_variable", fake_get_variable)
    monkeypatch.setattr(variables_api, "require_project_viewer", fake_require_project_viewer)
    monkeypatch.setattr(variables_api, "list_variable_comments", fake_list_comments)

    response = await api_client.get(f"/api/v1/assumptions/{variable.id}/comments")
    assert response.status_code == 200
    assert response.json() == []
