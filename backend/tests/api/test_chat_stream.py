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
        self.assumptions: dict[uuid.UUID, SimpleNamespace] = {}

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

    async def execute(self, *_args, **_kwargs):
        return _FakeExecuteResult([])

    async def scalar(self, _query):
        return 0

    async def refresh(self, _obj):
        return None

    async def get(self, model, obj_id):
        if getattr(model, "__name__", "") == "Assumption":
            return self.assumptions.get(obj_id)
        return None


def _collect_events(response):
    return [
        json.loads(line[6:])
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]


def _get_complete_event(response):
    return next(event for event in _collect_events(response) if event.get("type") == "complete")


@pytest.mark.asyncio
async def test_chat_stream_returns_proposed_value_widget_for_project_route(monkeypatch: pytest.MonkeyPatch):
    fake_db = _FakeDbSession()
    project_id = uuid.uuid4()
    chat_id = uuid.uuid4()
    assumption_id = uuid.uuid4()
    fake_db.assumptions[assumption_id] = SimpleNamespace(
        id=assumption_id,
        project_id=project_id,
        label="Capacity factor",
        key="capacity_factor",
        status="assumed",
        value=0.3,
        unit="%",
        used_in_assessments=["lcoe_model"],
    )

    async def override_db():
        yield fake_db

    async def override_ai_access():
        return SimpleNamespace(uid="user-1", id="user-1", email="test@example.com")

    async def fake_get_or_create_chat(_db, _user_id, _chat_id, project_id=None, assumption_id=None):
        assert assumption_id is not None
        return SimpleNamespace(
            id=chat_id,
            project_id=project_id,
            compare_project_ids=None,
            assumption_id=assumption_id,
        )

    async def fake_get_project_with_role(_db, _initiative_id, _user):
        initiative = SimpleNamespace(
            id=project_id,
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

    async def fake_generate_response(
        self,
        user_message,
        history,
        on_thinking=None,
        **kwargs,
    ):
        assert user_message == "Please investigate capacity factor."
        assert kwargs["project_id"] == str(project_id)
        assert kwargs["field_context"]["field_name"] == "capacity_factor"
        return chat_api.ServiceChatResponse(
            content="Try 42%.",
            sources=[],
            tiers_used=["planner"],
            latency_ms=7,
            widget_type="proposed_value",
            widget_data={
                "field_name": kwargs["field_context"]["field_name"],
                "label": kwargs["field_context"]["label"],
                "proposed_value": 0.42,
                "unit": kwargs["field_context"]["unit"],
                "model_type": kwargs["field_context"]["model_type"],
            },
        )

    app.dependency_overrides[chat_api.get_db] = override_db
    app.dependency_overrides[chat_api.require_ai_access] = override_ai_access
    monkeypatch.setattr(chat_api, "_get_or_create_chat", fake_get_or_create_chat)
    monkeypatch.setattr(chat_api, "get_project_with_role", fake_get_project_with_role)
    monkeypatch.setattr(chat_api, "build_context", fake_build_context)
    monkeypatch.setattr(chat_api.ChatService, "generate_response", fake_generate_response)

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
                    "project_id": str(project_id),
                    "field_context": {
                        "field_name": "capacity_factor",
                        "label": "Capacity factor",
                        "current_value": 0.3,
                        "unit": "%",
                        "model_type": "lcoe",
                        "status": "assumed",
                        "assumption_id": str(assumption_id),
                    },
                    "assumption_id": str(assumption_id),
                    "model_inputs_context": "### LCOE Model Inputs\n- Capacity factor (field_name=capacity_factor): 0.3 % [assumed]",
                },
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200

    complete_event = _get_complete_event(response)

    assert complete_event["widget_type"] == "proposed_value"
    assert complete_event["widget_data"]["field_name"] == "capacity_factor"
    assert complete_event["widget_data"]["proposed_value"] == 0.42


@pytest.mark.asyncio
async def test_chat_stream_assumption_investigate_skips_workspace_tool_hint(monkeypatch: pytest.MonkeyPatch):
    """tool_hint matches a workspace-flow assessment, but assumption-scoped sends must not reopen the module."""
    fake_db = _FakeDbSession()
    project_id = uuid.uuid4()
    chat_id = uuid.uuid4()
    assumption_id = uuid.uuid4()
    fake_db.assumptions[assumption_id] = SimpleNamespace(
        id=assumption_id,
        project_id=project_id,
        label="Fuel savings %",
        key="fuel_savings_pct",
        status="assumed",
        value=5.0,
        unit="%",
        used_in_assessments=["carbon_model"],
    )

    async def override_db():
        yield fake_db

    async def override_ai_access():
        return SimpleNamespace(uid="user-1", id="user-1", email="test@example.com")

    async def fake_get_or_create_chat(_db, _user_id, _chat_id, project_id=None, assumption_id=None):
        assert assumption_id is not None
        return SimpleNamespace(
            id=chat_id,
            project_id=project_id,
            compare_project_ids=None,
            assumption_id=assumption_id,
        )

    async def fake_get_project_with_role(_db, _initiative_id, _user):
        initiative = SimpleNamespace(
            id=project_id,
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

    async def fake_generate_response(
        self,
        user_message,
        history,
        on_thinking=None,
        **kwargs,
    ):
        assert kwargs.get("tool_hint") == "carbon_model"
        return chat_api.ServiceChatResponse(
            content="Suggest 8%.",
            sources=[],
            tiers_used=["planner"],
            latency_ms=3,
            widget_type="proposed_value",
            widget_data={
                "field_name": "fuel_savings_pct",
                "label": "Fuel savings %",
                "proposed_value": 8.0,
                "unit": "%",
                "model_type": "carbon",
            },
        )

    app.dependency_overrides[chat_api.get_db] = override_db
    app.dependency_overrides[chat_api.require_ai_access] = override_ai_access
    monkeypatch.setattr(chat_api, "_get_or_create_chat", fake_get_or_create_chat)
    monkeypatch.setattr(chat_api, "get_project_with_role", fake_get_project_with_role)
    monkeypatch.setattr(chat_api, "build_context", fake_build_context)
    monkeypatch.setattr(chat_api.ChatService, "generate_response", fake_generate_response)

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.post(
                "/api/v1/chat/stream",
                json={
                    "content": "Can you investigate and propose a value for Fuel savings %?",
                    "history": [],
                    "project_id": str(project_id),
                    "tool_hint": "carbon_model",
                    "field_context": {
                        "field_name": "fuel_savings_pct",
                        "label": "Fuel savings %",
                        "current_value": 5.0,
                        "unit": "%",
                        "model_type": "carbon",
                        "status": "assumed",
                        "assumption_id": str(assumption_id),
                    },
                    "assumption_id": str(assumption_id),
                    "model_inputs_context": "### Carbon Model Inputs\n- Fuel savings %: 5 %",
                },
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    complete_event = _get_complete_event(response)
    assert complete_event["widget_type"] == "proposed_value"
    assert complete_event["tiers_used"] == ["planner"]


@pytest.mark.asyncio
async def test_chat_stream_short_circuits_to_initial_project_onboarding(monkeypatch: pytest.MonkeyPatch):
    fake_db = _FakeDbSession()
    project_id = uuid.uuid4()
    chat_id = uuid.uuid4()

    async def override_db():
        yield fake_db

    async def override_ai_access():
        return SimpleNamespace(uid="user-1", id="user-1", email="test@example.com")

    async def fake_get_or_create_chat(_db, _user_id, _chat_id, project_id=None, assumption_id=None):
        return SimpleNamespace(
            id=chat_id,
            project_id=project_id,
            compare_project_ids=None,
            assumption_id=None,
        )

    async def fake_get_project_with_role(_db, _initiative_id, _user):
        initiative = SimpleNamespace(
            id=project_id,
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
        assert initiative.id == project_id
        assert current_user_message_id is not None
        return True

    extract_calls = []

    async def fake_extract_inputs(self, message, initiative):
        extract_calls.append((message, initiative.id))
        return {}

    async def fail_generate_response(*_args, **_kwargs):
        raise AssertionError("research pipeline should be skipped for scripted initial onboarding")

    app.dependency_overrides[chat_api.get_db] = override_db
    app.dependency_overrides[chat_api.require_ai_access] = override_ai_access
    monkeypatch.setattr(chat_api, "_get_or_create_chat", fake_get_or_create_chat)
    monkeypatch.setattr(chat_api, "get_project_with_role", fake_get_project_with_role)
    monkeypatch.setattr(chat_api, "build_context", fake_build_context)
    monkeypatch.setattr(
        chat_api,
        "_should_trigger_initial_project_onboarding",
        fake_should_trigger_initial_project_onboarding,
    )
    monkeypatch.setattr(chat_api.ChatService, "extract_inputs_from_message", fake_extract_inputs)
    monkeypatch.setattr(chat_api.ChatService, "generate_response", fail_generate_response)

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
                    "project_id": str(project_id),
                    "allow_initial_project_onboarding": True,
                },
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200

    complete_event = _get_complete_event(response)

    assert complete_event["widget_type"] == "document_request"
    assert complete_event["content"].startswith("Please upload any relevant project materials")
    assert extract_calls == [("Testing", project_id)]


@pytest.mark.asyncio
async def test_chat_stream_short_circuits_for_first_turn_even_if_global_guard_false(monkeypatch: pytest.MonkeyPatch):
    fake_db = _FakeDbSession()
    project_id = uuid.uuid4()
    chat_id = uuid.uuid4()

    async def override_db():
        yield fake_db

    async def override_ai_access():
        return SimpleNamespace(uid="user-1", id="user-1", email="test@example.com")

    async def fake_get_or_create_chat(_db, _user_id, _chat_id, project_id=None, assumption_id=None):
        return SimpleNamespace(
            id=chat_id,
            project_id=project_id,
            compare_project_ids=None,
            assumption_id=None,
        )

    async def fake_get_project_with_role(_db, _initiative_id, _user):
        initiative = SimpleNamespace(
            id=project_id,
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
        assert initiative.id == project_id
        assert current_user_message_id is not None
        return False

    extract_calls = []

    async def fake_extract_inputs(self, message, initiative):
        extract_calls.append((message, initiative.id))
        return {}

    async def fail_generate_response(*_args, **_kwargs):
        raise AssertionError("research pipeline should be skipped for first-turn onboarding prompt")

    app.dependency_overrides[chat_api.get_db] = override_db
    app.dependency_overrides[chat_api.require_ai_access] = override_ai_access
    monkeypatch.setattr(chat_api, "_get_or_create_chat", fake_get_or_create_chat)
    monkeypatch.setattr(chat_api, "get_project_with_role", fake_get_project_with_role)
    monkeypatch.setattr(chat_api, "build_context", fake_build_context)
    monkeypatch.setattr(
        chat_api,
        "_should_trigger_initial_project_onboarding",
        fake_should_trigger_initial_project_onboarding,
    )
    monkeypatch.setattr(chat_api.ChatService, "extract_inputs_from_message", fake_extract_inputs)
    monkeypatch.setattr(chat_api.ChatService, "generate_response", fail_generate_response)

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
                    "project_id": str(project_id),
                    "allow_initial_project_onboarding": True,
                },
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200

    complete_event = _get_complete_event(response)

    assert complete_event["widget_type"] == "document_request"
    assert complete_event["content"].startswith("Please upload any relevant project materials")
    assert extract_calls == [("Testing", project_id)]
