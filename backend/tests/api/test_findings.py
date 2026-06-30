import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.api import findings as findings_api
from app.models.chat import CoreChatMessage
from app.models.finding import Finding
from app.models.project import Project
from app.models.user import User
from tests.api.conftest import FakeExecuteResult


@pytest.mark.asyncio
async def test_promote_finding_returns_404_when_message_missing(
    api_client,
    override_db,
    auth_user_override,
    monkeypatch: pytest.MonkeyPatch,
):
    override_db()
    auth_user_override()
    project_id = uuid.uuid4()
    message_id = uuid.uuid4()

    async def fake_ensure_user_exists(_db, _user):
        return None

    async def fake_require_project_editor(_db, _project_id, _user):
        return SimpleNamespace(id=project_id)

    monkeypatch.setattr(findings_api, "ensure_user_exists", fake_ensure_user_exists)
    monkeypatch.setattr(findings_api, "require_project_editor", fake_require_project_editor)

    response = await api_client.post(
        "/api/v1/findings/promote",
        json={
            "chat_message_id": str(message_id),
            "project_id": str(project_id),
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Chat message not found"


@pytest.mark.asyncio
async def test_promote_finding_returns_400_when_body_empty(
    api_client,
    override_db,
    auth_user_override,
    monkeypatch: pytest.MonkeyPatch,
):
    project_id = uuid.uuid4()
    message_id = uuid.uuid4()
    message = SimpleNamespace(
        id=message_id,
        content="   ",
        sources=None,
    )
    fake_db = override_db(
        get_map={
            (CoreChatMessage.__name__, message_id): message,
        }
    )
    auth_user_override()

    async def fake_ensure_user_exists(_db, _user):
        return None

    async def fake_require_project_editor(_db, _project_id, _user):
        return SimpleNamespace(id=project_id)

    monkeypatch.setattr(findings_api, "ensure_user_exists", fake_ensure_user_exists)
    monkeypatch.setattr(findings_api, "require_project_editor", fake_require_project_editor)

    response = await api_client.post(
        "/api/v1/findings/promote",
        json={
            "chat_message_id": str(message_id),
            "project_id": str(project_id),
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Finding body is empty"
    assert fake_db.added == []


@pytest.mark.asyncio
async def test_promote_finding_success(
    api_client,
    override_db,
    auth_user_override,
    monkeypatch: pytest.MonkeyPatch,
):
    project_id = uuid.uuid4()
    message_id = uuid.uuid4()
    initiative = SimpleNamespace(id=project_id)
    message = SimpleNamespace(
        id=message_id,
        content="Solar capacity factor is 42%.",
        sources=[{"title": "Report", "url": "https://example.com"}],
    )
    fake_db = override_db(
        get_map={
            (CoreChatMessage.__name__, message_id): message,
            (Project.__name__, project_id): initiative,
        }
    )
    auth_user_override()
    extract_calls: list[dict] = []

    async def fake_ensure_user_exists(_db, _user):
        return None

    async def fake_require_project_editor(_db, _project_id, _user):
        return initiative

    async def fake_extract_assumptions_from_finding(db, project, **kwargs):
        extract_calls.append({"db": db, "project": project, **kwargs})

    monkeypatch.setattr(findings_api, "ensure_user_exists", fake_ensure_user_exists)
    monkeypatch.setattr(findings_api, "require_project_editor", fake_require_project_editor)
    monkeypatch.setattr(
        findings_api,
        "extract_assumptions_from_finding",
        fake_extract_assumptions_from_finding,
    )

    response = await api_client.post(
        "/api/v1/findings/promote",
        json={
            "chat_message_id": str(message_id),
            "project_id": str(project_id),
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["body"] == "Solar capacity factor is 42%."
    assert body["project_id"] == str(project_id)
    assert body["promoter_email"] == "test@example.com"
    assert len(extract_calls) == 1
    assert extract_calls[0]["project"] is initiative
    assert len(fake_db.added) == 1
    assert isinstance(fake_db.added[0], Finding)


@pytest.mark.asyncio
async def test_list_findings_returns_project_findings(
    api_client,
    override_db,
    auth_user_override,
    monkeypatch: pytest.MonkeyPatch,
):
    project_id = uuid.uuid4()
    finding_id = uuid.uuid4()
    finding = Finding(
        id=finding_id,
        project_id=project_id,
        body="Key insight",
        sources=None,
        promoted_by="user-1",
        source_chat_message_id=None,
        status="published",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    promoter = SimpleNamespace(email="owner@example.com")

    def execute_handler(_statement):
        return FakeExecuteResult([finding])

    fake_db = override_db(
        get_map={
            (User.__name__, "user-1"): promoter,
        },
        execute_handler=execute_handler,
    )
    auth_user_override()

    async def fake_ensure_user_exists(_db, _user):
        return None

    async def fake_get_project_with_role(_db, _project_id, _user):
        return SimpleNamespace(id=project_id), "editor"

    monkeypatch.setattr(findings_api, "ensure_user_exists", fake_ensure_user_exists)
    monkeypatch.setattr(findings_api, "get_project_with_role", fake_get_project_with_role)

    response = await api_client.get(f"/api/v1/projects/{project_id}/findings")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["findings"]) == 1
    assert payload["findings"][0]["id"] == str(finding_id)
    assert payload["findings"][0]["body"] == "Key insight"
    assert payload["findings"][0]["promoter_email"] == "owner@example.com"
