"""Legacy /assumptions* route aliases delegating to canonical variable handlers."""

from __future__ import annotations

from fastapi import APIRouter, status

from app.api import variables

router = APIRouter(include_in_schema=False)


def _alias(path: str, handler, methods: list[str], **kwargs):
    router.add_api_route(path, handler, methods=methods, **kwargs)


# Project-scoped aliases (old resource name, new handlers)
_alias(
    "/projects/{project_id}/assumptions/summary",
    variables.get_variables_summary,
    ["GET"],
)
_alias("/projects/{project_id}/assumptions", variables.get_variables, ["GET"])
_alias("/projects/{project_id}/assumptions/resolve", variables.resolve_variable, ["GET"])
_alias(
    "/projects/{project_id}/assumptions/from-chat",
    variables.create_variable_from_chat,
    ["POST"],
    status_code=status.HTTP_201_CREATED,
)
_alias(
    "/projects/{project_id}/assumptions",
    variables.create_variable,
    ["POST"],
    status_code=status.HTTP_201_CREATED,
)
_alias("/projects/{project_id}/assumptions/refresh", variables.refresh_variables, ["POST"])

# Resource-scoped aliases — path param name matches handler signature.
_alias("/assumptions/{variable_id}", variables.get_variable_detail, ["GET"])
_alias("/assumptions/{variable_id}", variables.patch_variable, ["PATCH"])
_alias(
    "/assumptions/{variable_id}",
    variables.remove_variable,
    ["DELETE"],
    status_code=status.HTTP_204_NO_CONTENT,
)
_alias("/assumptions/{variable_id}/comments", variables.get_variable_comments, ["GET"])
_alias(
    "/assumptions/{variable_id}/comments",
    variables.post_variable_comment,
    ["POST"],
    status_code=status.HTTP_201_CREATED,
)
