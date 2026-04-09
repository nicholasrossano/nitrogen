"""MCP-compatible exposure layer for selected Nitrogen capabilities."""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from mcp import types
from mcp.server.fastmcp.server import StreamableHTTPASGIApp
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.routing import Route

from app.adapters import get_adapter_registry
from app.adapters.base import BaseAdapter
from app.core.auth import AuthUser, authenticate_bearer_token
from app.core.database import AsyncSessionLocal
from app.core.execution_context import ExecutionContext, build_context
from app.core.permissions import get_initiative_with_role
from app.prompts.registry import PromptDefinition, get_prompt_registry
from app.resources import get_resource_registry
from app.resources.registry import ResourceDefinition

STDIO_USER_ID_ENV = "MCP_STDIO_USER_ID"
STDIO_USER_EMAIL_ENV = "MCP_STDIO_USER_EMAIL"
STDIO_DEFAULT_INITIATIVE_ENV = "MCP_DEFAULT_INITIATIVE_ID"
HTTP_DEV_USER_ID_HEADER = "x-mcp-dev-user-id"
HTTP_DEV_USER_EMAIL_HEADER = "x-mcp-dev-user-email"
HTTP_DEV_BYPASS_ENV = "MCP_ALLOW_DEV_HTTP_AUTH"
HTTP_DEV_USER_ID_ENV = "MCP_HTTP_DEV_USER_ID"
HTTP_DEV_USER_EMAIL_ENV = "MCP_HTTP_DEV_USER_EMAIL"

_server: Server[Any, Request] | None = None
_http_app: Starlette | None = None


def _is_exposed_adapter(adapter: BaseAdapter) -> bool:
    return adapter.definition.visibility == "exposed"


def _is_exposed_resource(definition: ResourceDefinition) -> bool:
    return definition.visibility == "exposed"


def _is_exposed_prompt(definition: PromptDefinition) -> bool:
    return definition.visibility == "exposed"


def _build_tool_definition(adapter: BaseAdapter) -> types.Tool:
    definition = adapter.definition
    return types.Tool(
        name=definition.adapter_id,
        title=definition.name,
        description=definition.description,
        inputSchema=definition.input_schema,
        outputSchema=definition.output_schema,
    )


def _build_resource_definition(definition: ResourceDefinition) -> types.Resource:
    return types.Resource(
        uri=definition.uri_pattern,
        name=definition.name,
        title=definition.name,
        description=definition.description,
        mimeType=definition.mime_type,
    )


def _build_resource_template(definition: ResourceDefinition) -> types.ResourceTemplate:
    return types.ResourceTemplate(
        uriTemplate=definition.uri_pattern,
        name=definition.name,
        title=definition.name,
        description=definition.description,
        mimeType=definition.mime_type,
    )


def _build_prompt_definition(definition: PromptDefinition) -> types.Prompt:
    return types.Prompt(
        name=definition.id,
        title=definition.name,
        description=definition.description,
        arguments=[
            types.PromptArgument(
                name=parameter,
                description=f"Template argument '{parameter}'.",
                required=False,
            )
            for parameter in definition.parameters
        ] or None,
    )


def list_exposed_tools() -> list[types.Tool]:
    return [
        _build_tool_definition(adapter)
        for adapter in get_adapter_registry().list_all()
        if _is_exposed_adapter(adapter)
    ]


def list_exposed_resources() -> list[types.Resource]:
    return [
        _build_resource_definition(definition)
        for definition in get_resource_registry().list_definitions()
        if _is_exposed_resource(definition)
    ]


def list_exposed_resource_templates() -> list[types.ResourceTemplate]:
    return [
        _build_resource_template(definition)
        for definition in get_resource_registry().list_definitions()
        if _is_exposed_resource(definition)
    ]


def list_exposed_prompts() -> list[types.Prompt]:
    return [
        _build_prompt_definition(definition)
        for definition in get_prompt_registry().list_all()
        if _is_exposed_prompt(definition)
    ]


def _get_adapter_or_raise(name: str) -> BaseAdapter:
    adapter = get_adapter_registry().get(name)
    if adapter is None or not _is_exposed_adapter(adapter):
        raise ValueError(f"MCP tool '{name}' is not exposed.")
    return adapter


def _get_resource_or_raise(uri: str) -> tuple[ResourceDefinition, dict[str, str]]:
    resolved = get_resource_registry().resolve(uri)
    if resolved is None:
        raise ValueError(f"Unknown MCP resource URI: {uri}")

    definition, params = resolved
    if not _is_exposed_resource(definition):
        raise ValueError(f"MCP resource '{definition.resource_type}' is not exposed.")
    return definition, params


def _get_prompt_or_raise(name: str) -> PromptDefinition:
    definition = get_prompt_registry().get(name)
    if definition is None or not _is_exposed_prompt(definition):
        raise ValueError(f"MCP prompt '{name}' is not exposed.")
    return definition


def _request_from_context(server: Server[Any, Request]) -> Request | None:
    try:
        return server.request_context.request
    except LookupError:
        return None


def _parse_initiative_id(arguments: Mapping[str, Any] | None = None, uri: str | None = None) -> UUID | None:
    if arguments:
        initiative_id = arguments.get("initiative_id")
        if initiative_id:
            return UUID(str(initiative_id))

    if uri:
        definition, params = _get_resource_or_raise(uri)
        if definition.initiative_scoped:
            return UUID(params["id"])

    default_initiative_id = os.getenv(STDIO_DEFAULT_INITIATIVE_ENV)
    if default_initiative_id:
        return UUID(default_initiative_id)

    return None


async def _resolve_request_user(request: Request | None) -> AuthUser:
    if request is None:
        return AuthUser(
            uid=os.getenv(STDIO_USER_ID_ENV, "mcp-stdio"),
            email=os.getenv(STDIO_USER_EMAIL_ENV, "mcp@localhost"),
        )

    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() == "bearer" and token:
        return await authenticate_bearer_token(token)

    if os.getenv(HTTP_DEV_BYPASS_ENV, "").lower() in {"1", "true", "yes"}:
        dev_user_id = request.headers.get(HTTP_DEV_USER_ID_HEADER) or os.getenv(HTTP_DEV_USER_ID_ENV)
        if dev_user_id:
            return AuthUser(
                uid=dev_user_id,
                email=request.headers.get(HTTP_DEV_USER_EMAIL_HEADER) or os.getenv(HTTP_DEV_USER_EMAIL_ENV),
            )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="MCP HTTP requests require a Bearer token.",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def build_mcp_context(
    arguments: Mapping[str, Any] | None = None,
    *,
    uri: str | None = None,
    request: Request | None = None,
) -> ExecutionContext:
    initiative_id = _parse_initiative_id(arguments, uri)
    user = await _resolve_request_user(request)

    async with AsyncSessionLocal() as db:
        if initiative_id is not None:
            await get_initiative_with_role(db, initiative_id, user)
        return await build_context(db, user, initiative_id)


async def call_exposed_tool(
    name: str,
    arguments: Mapping[str, Any] | None = None,
    *,
    request: Request | None = None,
) -> types.CallToolResult:
    adapter = _get_adapter_or_raise(name)
    tool_arguments = dict(arguments or {})

    if adapter.definition.initiative_scope_required and not tool_arguments.get("initiative_id"):
        raise ValueError(f"MCP tool '{name}' requires initiative_id.")

    ctx = await build_mcp_context(tool_arguments, request=request)
    async with AsyncSessionLocal() as db:
        result = await adapter.execute(ctx, db, tool_arguments)

    return types.CallToolResult(
        content=[types.TextContent(type="text", text=json.dumps(result.output))],
        structuredContent=result.output,
        isError=False,
    )


async def read_exposed_resource(
    uri: str,
    *,
    request: Request | None = None,
) -> str:
    definition, _params = _get_resource_or_raise(uri)
    ctx = await build_mcp_context(uri=uri, request=request)

    async with AsyncSessionLocal() as db:
        payload = await definition.read_handler(uri, db, ctx)

    return json.dumps(payload)


def _render_prompt_template(definition: PromptDefinition, arguments: Mapping[str, str] | None) -> str:
    if not arguments:
        return definition.template

    try:
        return definition.template.format(**arguments)
    except (IndexError, KeyError, ValueError):
        return definition.template


async def get_exposed_prompt(
    name: str,
    arguments: dict[str, str] | None = None,
) -> types.GetPromptResult:
    definition = _get_prompt_or_raise(name)
    rendered_prompt = _render_prompt_template(definition, arguments)
    return types.GetPromptResult(
        description=definition.description,
        messages=[
            types.PromptMessage(
                role="user",
                content=types.TextContent(type="text", text=rendered_prompt),
            )
        ],
    )


def _create_server() -> Server[Any, Request]:
    server: Server[Any, Request] = Server(
        name="nitrogen",
        instructions=(
            "Expose stable Nitrogen adapters and resource URIs over MCP without changing "
            "the internal execution path."
        ),
    )

    @server.list_tools()
    async def _list_tools() -> list[types.Tool]:
        return list_exposed_tools()

    @server.call_tool()
    async def _call_tool(name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        return await call_exposed_tool(name, arguments, request=_request_from_context(server))

    @server.list_resources()
    async def _list_resources() -> list[types.Resource]:
        return list_exposed_resources()

    @server.list_resource_templates()
    async def _list_resource_templates() -> list[types.ResourceTemplate]:
        return list_exposed_resource_templates()

    @server.read_resource()
    async def _read_resource(uri: str) -> str:
        return await read_exposed_resource(str(uri), request=_request_from_context(server))

    @server.list_prompts()
    async def _list_prompts() -> list[types.Prompt]:
        return list_exposed_prompts()

    @server.get_prompt()
    async def _get_prompt(name: str, arguments: dict[str, str] | None) -> types.GetPromptResult:
        return await get_exposed_prompt(name, arguments)

    return server


def get_mcp_server() -> Server[Any, Request]:
    global _server
    if _server is None:
        _server = _create_server()
    return _server


def create_mcp_http_app() -> tuple[Starlette, StreamableHTTPSessionManager]:
    manager = StreamableHTTPSessionManager(app=get_mcp_server())
    transport_app = StreamableHTTPASGIApp(manager)
    return (
        Starlette(
            routes=[Route("/", endpoint=transport_app)],
            lifespan=lambda app: manager.run(),
        ),
        manager,
    )


def get_mcp_http_app() -> Starlette:
    global _http_app
    if _http_app is None:
        _http_app, _manager = create_mcp_http_app()
    return _http_app


async def run_stdio_server() -> None:
    server = get_mcp_server()
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(),
        )

