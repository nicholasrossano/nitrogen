import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

from app.api import onboarding as onboarding_api
from app.main import app
from app.services.project_chat_router import ProjectChatRouter
from app.services.project_tool_executor import ProjectToolExecutor


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
    def __init__(self, history=None):
        self._history = list(history or [])
        self.added = []

    def add(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()
        if getattr(obj, "created_at", None) is None:
            obj.created_at = datetime.now(timezone.utc)
        self.added.append(obj)

    async def commit(self):
        return None

    async def refresh(self, _obj):
        return None

    async def execute(self, *_args, **_kwargs):
        return _FakeExecuteResult([*self._history, *self.added])


def _build_initiative(initiative_id):
    touches = []

    def touch():
        touches.append("touch")

    return SimpleNamespace(
        id=initiative_id,
        title=None,
        project_type=None,
        project_description=None,
        geography=None,
        selected_tools=[],
        goal=None,
        project_plan=None,
        evidence_ready=False,
        stage="stage_1",
        stage_1_complete=False,
        tool_inputs={},
        icon=None,
        target_population=None,
        user_id="user-1",
        touch=touch,
        _touches=touches,
    )


@pytest.mark.asyncio
async def test_onboarding_chat_first_user_message_returns_hardcoded_document_request(
    monkeypatch: pytest.MonkeyPatch,
):
    initiative_id = uuid.uuid4()
    fake_db = _FakeDbSession()
    initiative = _build_initiative(initiative_id)

    async def override_db():
        yield fake_db

    async def override_ai_access():
        return SimpleNamespace(uid="user-1", id="user-1", email="test@example.com")

    async def fake_require_editor(_db, _initiative_id, _user):
        assert _initiative_id == str(initiative_id)
        return initiative

    async def fail_extract_inputs(*_args, **_kwargs):
        raise AssertionError("first-turn onboarding should bypass input extraction")

    async def fail_get_next_action(*_args, **_kwargs):
        raise AssertionError("first-turn onboarding should bypass orchestration")

    async def fail_execute_project_action(*_args, **_kwargs):
        raise AssertionError("first-turn onboarding should bypass project action execution")

    app.dependency_overrides[onboarding_api.get_db] = override_db
    app.dependency_overrides[onboarding_api.require_ai_access] = override_ai_access
    monkeypatch.setattr(onboarding_api, "require_editor", fake_require_editor)
    monkeypatch.setattr(onboarding_api.ChatService, "extract_inputs_from_message", fail_extract_inputs)
    monkeypatch.setattr(ProjectChatRouter, "get_next_action", fail_get_next_action)
    monkeypatch.setattr(ProjectToolExecutor, "execute_project_action", fail_execute_project_action)

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.post(
                f"/api/v1/initiatives/{initiative_id}/chat",
                json={"content": "We are building a solar mini-grid in Kenya."},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["message"]["widget_type"] == "document_request"
    assert payload["message"]["content"] == onboarding_api._INITIAL_ONBOARDING_DOCUMENT_PROMPT


@pytest.mark.asyncio
async def test_onboarding_chat_skips_input_extraction_for_synthetic_document_upload_message(
    monkeypatch: pytest.MonkeyPatch,
):
    initiative_id = uuid.uuid4()
    prior_history = [
        SimpleNamespace(
            id=uuid.uuid4(),
            initiative_id=initiative_id,
            role="user",
            content="We are building a solar mini-grid in Kenya.",
            widget_type=None,
            widget_data=None,
            sources=[],
            completion_meta={},
            thinking_lines=None,
            feedback=None,
            created_at=datetime.now(timezone.utc),
        ),
        SimpleNamespace(
            id=uuid.uuid4(),
            initiative_id=initiative_id,
            role="assistant",
            content="Please upload any relevant project materials.",
            widget_type="document_request",
            widget_data={"allow_multiple": True},
            sources=[],
            completion_meta={},
            thinking_lines=None,
            feedback=None,
            created_at=datetime.now(timezone.utc),
        )
    ]
    fake_db = _FakeDbSession(history=prior_history)
    initiative = _build_initiative(initiative_id)
    extract_calls = []
    action_calls = []

    async def override_db():
        yield fake_db

    async def override_ai_access():
        return SimpleNamespace(uid="user-1", id="user-1", email="test@example.com")

    async def fake_require_editor(_db, _initiative_id, _user):
        return initiative

    async def fake_extract_inputs(self, message, initiative):
        extract_calls.append((message, initiative.id))
        return {"project_title": "Should not happen"}

    async def fake_get_next_action(self, messages, initiative, tool_hint=None, field_context=None, onboarding_mode=False):
        action_calls.append(
            {
                "message_count": len(messages),
                "tool_hint": tool_hint,
                "field_context": field_context,
                "onboarding_mode": onboarding_mode,
            }
        )
        return SimpleNamespace(
            action="generate_project_plan",
            parameters={"message": "Generating your plan."},
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
        assert action_result.action == "generate_project_plan"
        return (
            "plan_structure",
            {"recommendations": [{"recommended": True}]},
            "Generating your plan.",
            [],
        )

    app.dependency_overrides[onboarding_api.get_db] = override_db
    app.dependency_overrides[onboarding_api.require_ai_access] = override_ai_access
    monkeypatch.setattr(onboarding_api, "require_editor", fake_require_editor)
    monkeypatch.setattr(onboarding_api.ChatService, "extract_inputs_from_message", fake_extract_inputs)
    monkeypatch.setattr(ProjectChatRouter, "get_next_action", fake_get_next_action)
    monkeypatch.setattr(ProjectToolExecutor, "execute_project_action", fake_execute_project_action)

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.post(
                f"/api/v1/initiatives/{initiative_id}/chat",
                json={"content": "I've uploaded my documents."},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["message"]["widget_type"] == "plan_structure"
    assert extract_calls == []
    assert action_calls == [
        {
            "message_count": 3,
            "tool_hint": None,
            "field_context": None,
            "onboarding_mode": True,
        }
    ]
