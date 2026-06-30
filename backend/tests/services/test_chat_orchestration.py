import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.core.execution_context import ExecutionContext
from app.services.chat import ChatService


class _FakeCompletions:
    def __init__(self, response):
        self._response = response
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return self._response


class _FakeClient:
    def __init__(self, response):
        self.chat = SimpleNamespace(completions=_FakeCompletions(response))


def _build_ctx():
    return ExecutionContext(
        user_id="user-1",
        user_email="test@example.com",
        project_id=None,
        initiative_role="editor",
        ai_access_granted=True,
        is_byok=False,
        request_id="req-1",
        chat_id=uuid4(),
    )


def _build_service():
    return ChatService(db=SimpleNamespace(), ctx=_build_ctx())


@pytest.mark.asyncio
async def test_get_next_action_short_circuits_for_tool_hint(monkeypatch: pytest.MonkeyPatch):
    service = _build_service()

    async def fail_acomplete(*_args, **_kwargs):
        raise AssertionError("tool hint short-circuit should not call the LLM")

    monkeypatch.setattr(service, "_acomplete", fail_acomplete)

    result = await service.project_router.get_next_action(
        messages=[],
        initiative=SimpleNamespace(),
        tool_hint="lcoe_model",
        onboarding_mode=True,
    )

    assert result.action == "run_lcoe"
    assert "LCOE" in result.parameters["message"]
    assert result.sources_used == []


@pytest.mark.asyncio
async def test_get_next_action_short_circuits_for_field_context(monkeypatch: pytest.MonkeyPatch):
    service = _build_service()

    async def fail_acomplete(*_args, **_kwargs):
        raise AssertionError("field-context short-circuit should not call the LLM")

    monkeypatch.setattr(service, "_acomplete", fail_acomplete)

    result = await service.project_router.get_next_action(
        messages=[],
        initiative=SimpleNamespace(),
        field_context={
            "field_name": "capacity_factor",
            "label": "Capacity Factor",
            "current_value": 0.3,
            "unit": "%",
            "model_type": "lcoe",
            "status": "assumed",
        },
        onboarding_mode=True,
    )

    assert result.action == "propose_input_value"
    assert result.parameters["field_name"] == "capacity_factor"
    assert result.parameters["model_type"] == "lcoe"


@pytest.mark.asyncio
async def test_get_next_action_returns_mocked_llm_tool_call(monkeypatch: pytest.MonkeyPatch):
    tool_call = SimpleNamespace(
        function=SimpleNamespace(
            name="generate_project_plan",
            arguments=json.dumps({"message": "Generating your project plan."}),
        )
    )
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(tool_calls=[tool_call]))]
    )
    service = _build_service()
    acomplete_calls = []

    async def fake_acomplete(role, complexity, **kwargs):
        acomplete_calls.append({"role": role, "complexity": complexity, **kwargs})
        return response

    async def fake_retrieve_for_context(*_args, **_kwargs):
        return {}

    monkeypatch.setattr(service, "_acomplete", fake_acomplete)
    monkeypatch.setattr(service, "_get_tool_list", lambda *args, **kwargs: [{"function": {"name": "generate_project_plan"}}])
    monkeypatch.setattr(service.retrieval, "retrieve_for_context", fake_retrieve_for_context)
    monkeypatch.setattr(service.retrieval, "format_context_for_prompt", lambda *_args, **_kwargs: "")

    messages = [
        SimpleNamespace(role="user", content="We are building a solar mini-grid in Kenya.", widget_type=None)
    ]
    initiative = SimpleNamespace(
        title="Mini-grid",
        project_type="solar",
        project_description="Mini-grid build",
        geography="Kenya",
        evidence_ready=False,
        project_plan=None,
    )

    result = await service.project_router.get_next_action(
        messages=messages,
        initiative=initiative,
        onboarding_mode=True,
    )

    assert result.action == "generate_project_plan"
    assert result.parameters == {"message": "Generating your project plan."}
    create_kwargs = acomplete_calls[0]
    assert create_kwargs["tool_choice"] == "required"
    assert create_kwargs["temperature"] == 0.7
    assert create_kwargs["tools"] == [{"function": {"name": "generate_project_plan"}}]


@pytest.mark.asyncio
async def test_plan_tool_calls_returns_llm_tool_calls(monkeypatch: pytest.MonkeyPatch):
    tool_calls = [
        SimpleNamespace(
            function=SimpleNamespace(
                name="search_web_sources",
                arguments=json.dumps(
                    {
                        "query": "utility solar capacity factor Kenya",
                        "reason": "Need current benchmarks",
                    }
                ),
            )
        )
    ]
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(tool_calls=tool_calls))]
    )
    service = _build_service()
    acomplete_calls = []

    async def fake_acomplete(role, complexity, **kwargs):
        acomplete_calls.append(kwargs)
        return response

    monkeypatch.setattr(service, "_acomplete", fake_acomplete)
    monkeypatch.setattr(service, "_get_tool_list", lambda *args, **kwargs: [{"function": {"name": "search_web_sources"}}])

    result = await service._plan_tool_calls(
        user_message="What is a typical solar capacity factor in Kenya?",
        history=[],
        project_id=str(uuid4()),
    )

    assert result == tool_calls
    create_kwargs = acomplete_calls[0]
    assert create_kwargs["tool_choice"] == "auto"
    assert create_kwargs["temperature"] == 0
    assert create_kwargs["tools"] == [{"function": {"name": "search_web_sources"}}]
