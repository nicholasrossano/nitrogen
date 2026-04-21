import json
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

from app.api import chat as chat_api
from app.main import app


class _FakeScalarResult:
    def __init__(self, items):
        self._items = items

    def all(self):
        return list(self._items)


class _FakeExecuteResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return _FakeScalarResult(self._items)


class _FakeDbSession:
    def __init__(self):
        self.added = []

    def add(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()
        if getattr(obj, "created_at", None) is None:
            obj.created_at = datetime.now(timezone.utc)
        self.added.append(obj)

    async def flush(self):
        return None

    async def commit(self):
        return None

    async def rollback(self):
        return None

    async def execute(self, _query):
        return _FakeExecuteResult([])

    async def scalar(self, _query):
        return 0


@pytest.mark.asyncio
async def test_chat_stream_returns_proposed_value_widget_for_project_route(monkeypatch: pytest.MonkeyPatch):
    fake_db = _FakeDbSession()
    initiative_id = uuid.uuid4()
    chat_id = uuid.uuid4()

    async def override_db():
        yield fake_db

    async def override_ai_access():
        return SimpleNamespace(uid="user-1", id="user-1", email="test@example.com")

    async def fake_get_or_create_chat(_db, _user_id, _chat_id, initiative_id=None):
        return SimpleNamespace(
            id=chat_id,
            initiative_id=initiative_id,
            compare_initiative_ids=None,
        )

    async def fake_get_initiative_with_role(_db, _initiative_id, _user):
        initiative = SimpleNamespace(
            id=initiative_id,
            title="Test project",
            project_type="solar",
            project_description="A test project",
            geography="Kenya",
            selected_tools=[],
            goal="Estimate value",
        )
        return initiative, "editor"

    async def fake_build_context(_db, _user, _initiative_id):
        return SimpleNamespace(user_id="user-1", chat_id=None)

    async def fake_get_next_action(self, messages, initiative, tool_hint=None, field_context=None, onboarding_mode=False):
        return SimpleNamespace(
            action="propose_input_value",
            parameters={
                "field_name": field_context["field_name"],
                "label": field_context["label"],
                "model_type": field_context["model_type"],
                "current_value": field_context["current_value"],
                "unit": field_context["unit"],
                "status": field_context["status"],
            },
            sources_used=[],
        )

    async def fake_execute_project_action(
        self,
        initiative,
        action_result,
        chat_history=None,
        tool_hint=None,
        model_inputs_context=None,
        field_context=None,
        on_thinking=None,
    ):
        return (
            "proposed_value",
            {
                "field_name": field_context["field_name"],
                "label": field_context["label"],
                "proposed_value": 0.42,
                "unit": field_context["unit"],
                "model_type": field_context["model_type"],
            },
            "Try 42%.",
            [],
        )

    app.dependency_overrides[chat_api.get_db] = override_db
    app.dependency_overrides[chat_api.require_ai_access] = override_ai_access
    monkeypatch.setattr(chat_api, "_get_or_create_chat", fake_get_or_create_chat)
    monkeypatch.setattr(chat_api, "get_initiative_with_role", fake_get_initiative_with_role)
    monkeypatch.setattr(chat_api, "build_context", fake_build_context)
    monkeypatch.setattr(chat_api.ChatService, "get_next_action", fake_get_next_action)
    monkeypatch.setattr(chat_api.ChatService, "execute_project_action", fake_execute_project_action)

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.post(
                "/api/v1/chat/stream",
                json={
                    "content": "Please investigate capacity factor.",
                    "history": [],
                    "initiative_id": str(initiative_id),
                    "field_context": {
                        "field_name": "capacity_factor",
                        "label": "Capacity factor",
                        "current_value": 0.3,
                        "unit": "%",
                        "model_type": "lcoe",
                        "status": "assumed",
                    },
                    "model_inputs_context": "### LCOE Model Inputs\n- Capacity factor (field_name=capacity_factor): 0.3 % [assumed]",
                },
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200

    events = [
        json.loads(line[6:])
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    complete_event = next(event for event in events if event.get("type") == "complete")

    assert complete_event["widget_type"] == "proposed_value"
    assert complete_event["widget_data"]["field_name"] == "capacity_factor"
    assert complete_event["widget_data"]["proposed_value"] == 0.42


@pytest.mark.asyncio
async def test_chat_stream_short_circuits_to_initial_project_onboarding(monkeypatch: pytest.MonkeyPatch):
    fake_db = _FakeDbSession()
    initiative_id = uuid.uuid4()
    chat_id = uuid.uuid4()

    async def override_db():
        yield fake_db

    async def override_ai_access():
        return SimpleNamespace(uid="user-1", id="user-1", email="test@example.com")

    async def fake_get_or_create_chat(_db, _user_id, _chat_id, initiative_id=None):
        return SimpleNamespace(
            id=chat_id,
            initiative_id=initiative_id,
            compare_initiative_ids=None,
        )

    async def fake_get_initiative_with_role(_db, _initiative_id, _user):
        initiative = SimpleNamespace(
            id=initiative_id,
            title=None,
            project_type=None,
            project_description=None,
            geography=None,
            selected_tools=[],
            goal=None,
            project_plan=None,
            evidence_ready=False,
        )
        return initiative, "editor"

    async def fake_build_context(_db, _user, _initiative_id):
        return SimpleNamespace(user_id="user-1", chat_id=None)

    async def fake_should_trigger_initial_project_onboarding(_db, *, user_id, initiative, current_user_message_id):
        assert user_id == "user-1"
        assert initiative.id == initiative_id
        assert current_user_message_id is not None
        return True

    async def fail_extract_inputs(*_args, **_kwargs):
        raise AssertionError("input extraction should be skipped for initial onboarding")

    async def fail_get_next_action(*_args, **_kwargs):
        raise AssertionError("orchestration should be skipped for initial onboarding")

    app.dependency_overrides[chat_api.get_db] = override_db
    app.dependency_overrides[chat_api.require_ai_access] = override_ai_access
    monkeypatch.setattr(chat_api, "_get_or_create_chat", fake_get_or_create_chat)
    monkeypatch.setattr(chat_api, "get_initiative_with_role", fake_get_initiative_with_role)
    monkeypatch.setattr(chat_api, "build_context", fake_build_context)
    monkeypatch.setattr(
        chat_api,
        "_should_trigger_initial_project_onboarding",
        fake_should_trigger_initial_project_onboarding,
    )
    monkeypatch.setattr(chat_api.ChatService, "extract_inputs_from_message", fail_extract_inputs)
    monkeypatch.setattr(chat_api.ChatService, "get_next_action", fail_get_next_action)

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.post(
                "/api/v1/chat/stream",
                json={
                    "content": "Testing",
                    "history": [],
                    "initiative_id": str(initiative_id),
                    "allow_initial_project_onboarding": True,
                },
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200

    events = [
        json.loads(line[6:])
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    complete_event = next(event for event in events if event.get("type") == "complete")

    assert complete_event["widget_type"] == "document_request"
    assert complete_event["content"].startswith("Please upload any relevant project materials")


@pytest.mark.asyncio
async def test_chat_stream_short_circuits_for_first_turn_even_if_global_guard_false(monkeypatch: pytest.MonkeyPatch):
    fake_db = _FakeDbSession()
    initiative_id = uuid.uuid4()
    chat_id = uuid.uuid4()

    async def override_db():
        yield fake_db

    async def override_ai_access():
        return SimpleNamespace(uid="user-1", id="user-1", email="test@example.com")

    async def fake_get_or_create_chat(_db, _user_id, _chat_id, initiative_id=None):
        return SimpleNamespace(
            id=chat_id,
            initiative_id=initiative_id,
            compare_initiative_ids=None,
        )

    async def fake_get_initiative_with_role(_db, _initiative_id, _user):
        initiative = SimpleNamespace(
            id=initiative_id,
            title=None,
            project_type=None,
            project_description=None,
            geography=None,
            selected_tools=[],
            goal=None,
            project_plan=None,
            evidence_ready=False,
        )
        return initiative, "editor"

    async def fake_build_context(_db, _user, _initiative_id):
        return SimpleNamespace(user_id="user-1", chat_id=None)

    async def fake_should_trigger_initial_project_onboarding(_db, *, user_id, initiative, current_user_message_id):
        assert user_id == "user-1"
        assert initiative.id == initiative_id
        assert current_user_message_id is not None
        return False

    async def fail_get_next_action(*_args, **_kwargs):
        raise AssertionError("orchestration should be skipped for first-turn onboarding prompt")

    app.dependency_overrides[chat_api.get_db] = override_db
    app.dependency_overrides[chat_api.require_ai_access] = override_ai_access
    monkeypatch.setattr(chat_api, "_get_or_create_chat", fake_get_or_create_chat)
    monkeypatch.setattr(chat_api, "get_initiative_with_role", fake_get_initiative_with_role)
    monkeypatch.setattr(chat_api, "build_context", fake_build_context)
    monkeypatch.setattr(
        chat_api,
        "_should_trigger_initial_project_onboarding",
        fake_should_trigger_initial_project_onboarding,
    )
    monkeypatch.setattr(chat_api.ChatService, "get_next_action", fail_get_next_action)

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.post(
                "/api/v1/chat/stream",
                json={
                    "content": "Testing",
                    "history": [],
                    "initiative_id": str(initiative_id),
                    "allow_initial_project_onboarding": True,
                },
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200

    events = [
        json.loads(line[6:])
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    complete_event = next(event for event in events if event.get("type") == "complete")

    assert complete_event["widget_type"] == "document_request"
    assert complete_event["content"].startswith("Please upload any relevant project materials")
