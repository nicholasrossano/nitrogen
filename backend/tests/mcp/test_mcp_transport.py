from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.client.streamable_http import streamable_http_client

from app.core.auth import AuthUser
from app.core.execution_context import ExecutionContext
from app.mcp import server as mcp_server
from app.resources import get_resource_registry


def _backend_dir() -> Path:
    return Path(__file__).resolve().parents[2]


def _ctx() -> ExecutionContext:
    return ExecutionContext(
        user_id="transport-user",
        user_email="transport@example.com",
        project_id=None,
        initiative_role=None,
        ai_access_granted=True,
        is_byok=False,
        request_id="transport-request-id",
    )


@pytest.mark.asyncio
async def test_mcp_stdio_transport_smoke() -> None:
    env = os.environ.copy()
    env.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    env.setdefault("OPENAI_API_KEY", "test-key-not-real")
    env.setdefault("FIREBASE_PROJECT_ID", "test-project")

    async with stdio_client(
        StdioServerParameters(
            command="python3",
            args=["-m", "app.mcp.run"],
            cwd=_backend_dir(),
            env=env,
        )
    ) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()

            tools = await session.list_tools()
            assert {"lcoe", "carbon", "pvwatts", "retrieval", "openalex", "rag"}.issubset(
                {tool.name for tool in tools.tools}
            )

            success = await session.call_tool("lcoe", {"known_values": {}})
            assert success.isError is False
            assert success.structuredContent is not None
            assert success.structuredContent["computable"] is False

            error = await session.call_tool("rag", {"query": "cookstove adoption"})
            assert error.isError is True


@pytest.mark.asyncio
async def test_mcp_http_transport_smoke(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_auth(_token: str) -> AuthUser:
        return AuthUser(uid="http-user", email="http@example.com")

    async def _fake_build_context(_db, user, project_id=None) -> ExecutionContext:
        assert user.uid == "http-user"
        return _ctx()

    async def _fake_corpus_reader(uri: str, _db, _ctx) -> dict:
        return {"uri": uri, "resource_type": "corpus_doc", "data": {"title": "Test corpus doc"}}

    corpus_definition = next(
        definition
        for definition in get_resource_registry().list_definitions()
        if definition.resource_type == "corpus_doc"
    )

    monkeypatch.setattr(mcp_server, "authenticate_bearer_token", _fake_auth)
    monkeypatch.setattr(mcp_server, "build_context", _fake_build_context)
    monkeypatch.setattr(corpus_definition, "read_handler", _fake_corpus_reader)

    http_app, manager = mcp_server.create_mcp_http_app()

    async with manager.run():
        async with AsyncClient(
            transport=ASGITransport(app=http_app),
            base_url="http://testserver",
            headers={"authorization": "Bearer test-token"},
            follow_redirects=True,
        ) as http_client:
            async with streamable_http_client(
                "http://testserver/",
                http_client=http_client,
            ) as (read_stream, write_stream, _get_session_id):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()

                    tools = await session.list_tools()
                    assert "lcoe" in {tool.name for tool in tools.tools}

                    tool_result = await session.call_tool("lcoe", {"known_values": {}})
                    assert tool_result.isError is False
                    assert tool_result.structuredContent is not None

                    resource_result = await session.read_resource(f"nitrogen://corpus/{uuid4()}")
                    assert resource_result.contents
                    assert "Test corpus doc" in resource_result.contents[0].text

