from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.core.auth import AuthUser
from app.core.execution_context import ExecutionContext
from app.mcp import server as mcp_server
from app.resources import get_resource_registry


def _request(headers: dict[str, str]) -> SimpleNamespace:
    return SimpleNamespace(headers=headers)


def _ctx(project_id=None) -> ExecutionContext:
    return ExecutionContext(
        user_id="mcp-user",
        user_email="mcp@example.com",
        project_id=project_id,
        initiative_role="owner" if project_id else None,
        ai_access_granted=True,
        is_byok=False,
        request_id="mcp-test-request",
    )


@pytest.mark.asyncio
async def test_http_mcp_context_requires_bearer_auth() -> None:
    with pytest.raises(HTTPException, match="Bearer token"):
        await mcp_server.build_mcp_context(request=_request({}))


@pytest.mark.asyncio
async def test_internal_tools_are_not_callable_over_mcp() -> None:
    with pytest.raises(ValueError, match="not exposed"):
        await mcp_server.call_exposed_tool("memo_generation", {"project_id": str(uuid4())})


@pytest.mark.asyncio
async def test_project_scoped_tools_require_initiative_id() -> None:
    with pytest.raises(ValueError, match="requires project_id"):
        await mcp_server.call_exposed_tool("rag", {"query": "cookstove adoption"})


@pytest.mark.asyncio
async def test_internal_resources_are_hidden_from_mcp() -> None:
    uri = f"nitrogen://projects/{uuid4()}/assessments/{uuid4()}"
    with pytest.raises(ValueError, match="not exposed"):
        await mcp_server.read_exposed_resource(uri)


@pytest.mark.asyncio
async def test_http_context_propagates_initiative_access_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_auth(_token: str) -> AuthUser:
        return AuthUser(uid="http-user", email="http@example.com")

    async def _deny_access(_db, _initiative_id, _user) -> None:
        raise HTTPException(status_code=403, detail="Forbidden")

    async def _unused_build_context(*_args, **_kwargs):
        raise AssertionError("build_context should not run when access is denied")

    monkeypatch.setattr(mcp_server, "authenticate_bearer_token", _fake_auth)
    monkeypatch.setattr(mcp_server, "get_project_with_role", _deny_access)
    monkeypatch.setattr(mcp_server, "build_context", _unused_build_context)

    with pytest.raises(HTTPException, match="Forbidden"):
        await mcp_server.build_mcp_context(
            {"project_id": str(uuid4())},
            request=_request({"authorization": "Bearer test-token"}),
        )


@pytest.mark.asyncio
async def test_http_tool_calls_use_authenticated_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_auth(_token: str) -> AuthUser:
        return AuthUser(uid="http-user", email="http@example.com")

    async def _fake_build_context(_db, user, project_id=None) -> ExecutionContext:
        assert user.uid == "http-user"
        return _ctx(project_id)

    monkeypatch.setattr(mcp_server, "authenticate_bearer_token", _fake_auth)
    monkeypatch.setattr(mcp_server, "build_context", _fake_build_context)

    result = await mcp_server.call_exposed_tool(
        "lcoe",
        {"known_values": {}},
        request=_request({"authorization": "Bearer test-token"}),
    )

    assert result.isError is False
    assert result.structuredContent is not None
    assert result.structuredContent["computable"] is False


def test_exposure_policy_keeps_workflow_resources_internal() -> None:
    resource_types = {
        definition.resource_type: definition.visibility
        for definition in get_resource_registry().list_definitions()
    }
    assert resource_types["assessment_instance"] == "internal"
    assert resource_types["artifact"] == "internal"

