import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.api import shares as shares_api
from app.models.project_share import ProjectShare
from app.models.user import User
from tests.api.conftest import FakeExecuteResult


@pytest.mark.asyncio
async def test_create_share_returns_201_for_existing_user(
    api_client,
    override_db,
    auth_user_override,
    monkeypatch: pytest.MonkeyPatch,
):
    project_id = uuid.uuid4()
    initiative = SimpleNamespace(id=project_id)
    target_user = User(
        id="target-user",
        email="collaborator@example.com",
        display_name="Collaborator",
    )
    auth_user_override()

    def execute_handler(statement):
        statement_text = str(statement)
        if "project_shares" in statement_text:
            return FakeExecuteResult([])
        if "users" in statement_text.lower():
            return FakeExecuteResult([target_user])
        return FakeExecuteResult([])

    fake_db = override_db(execute_handler=execute_handler)

    async def fake_ensure_user_exists(_db, _user):
        return None

    async def fake_require_project_editor(_db, _project_id, _user):
        return initiative

    async def fake_resolve_user_by_email(_db, _email):
        return target_user

    async def fake_delete_invitations(_db, _project_id, _email):
        return None

    monkeypatch.setattr(shares_api, "ensure_user_exists", fake_ensure_user_exists)
    monkeypatch.setattr(shares_api, "require_project_editor", fake_require_project_editor)
    monkeypatch.setattr(shares_api, "_resolve_user_by_email", fake_resolve_user_by_email)
    monkeypatch.setattr(
        shares_api,
        "delete_project_share_invitations_for_email",
        fake_delete_invitations,
    )

    response = await api_client.post(
        f"/api/v1/projects/{project_id}/shares",
        json={"email": "collaborator@example.com", "role": "editor"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["user_email"] == "collaborator@example.com"
    assert body["role"] == "editor"
    assert body["pending"] is False
    assert len(fake_db.added) == 1
    assert isinstance(fake_db.added[0], ProjectShare)


@pytest.mark.asyncio
async def test_list_shares_returns_active_and_pending_rows(
    api_client,
    override_db,
    auth_user_override,
    monkeypatch: pytest.MonkeyPatch,
):
    project_id = uuid.uuid4()
    initiative = SimpleNamespace(id=project_id)
    share = SimpleNamespace(
        id=uuid.uuid4(),
        project_id=project_id,
        user_id="target-user",
        user=SimpleNamespace(
            email="collaborator@example.com",
            display_name="Collaborator",
        ),
        role="editor",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    invitation = SimpleNamespace(
        id=uuid.uuid4(),
        project_id=project_id,
        email="pending@example.com",
        role="viewer",
        created_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
    )
    call_count = {"n": 0}

    def execute_handler(_statement):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return FakeExecuteResult([share])
        return FakeExecuteResult([invitation])

    override_db(execute_handler=execute_handler)
    auth_user_override()

    async def fake_ensure_user_exists(_db, _user):
        return None

    async def fake_get_project_with_role(_db, _project_id, _user):
        return initiative, "owner"

    monkeypatch.setattr(shares_api, "ensure_user_exists", fake_ensure_user_exists)
    monkeypatch.setattr(shares_api, "get_project_with_role", fake_get_project_with_role)

    response = await api_client.get(f"/api/v1/projects/{project_id}/shares")

    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 2
    assert rows[0]["user_email"] == "collaborator@example.com"
    assert rows[0]["pending"] is False
    assert rows[1]["user_email"] == "pending@example.com"
    assert rows[1]["pending"] is True
