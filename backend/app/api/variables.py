from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser, get_current_user
from app.core.database import get_db
from app.models.chat import CoreChat
from app.core.permissions import require_project_editor, require_project_viewer
from app.schemas.variable import (
    VariableCommentCreate,
    VariableCommentResponse,
    VariableCreate,
    VariableFromChatRequest,
    VariableRefreshResponse,
    VariableResolveResponse,
    VariableResponse,
    VariableSummary,
    VariableUpdate,
)
from app.services.variables import (
    VariableActor,
    build_summary,
    create_variable_comment,
    delete_variable,
    get_variable,
    list_variable_comments,
    list_variables,
    promote_chat_value_to_variable,
    update_variable,
    upsert_variable,
    resolve_variable_for_assessment_field,
)

router = APIRouter()


def _actor_from_user(user: AuthUser) -> VariableActor:
    return VariableActor(user_id=user.uid, email=user.email or user.uid)


@router.get(
    "/projects/{project_id}/variables/summary",
    response_model=VariableSummary,
)
async def get_variables_summary(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Return project-level variables summary counts and attention items."""
    initiative = await require_project_viewer(db, project_id, user)
    return await build_summary(db, initiative.id)


@router.get(
    "/projects/{project_id}/variables",
    response_model=list[VariableResponse],
)
async def get_variables(
    project_id: str,
    status_filter: str | None = Query(default=None, alias="status"),
    source_type: str | None = None,
    assessment: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List project variables (API resource: variables) with optional filters."""
    initiative = await require_project_viewer(db, project_id, user)
    return await list_variables(
        db,
        initiative.id,
        status=status_filter,
        source_type=source_type,
        assessment=assessment,
    )


@router.get(
    "/projects/{project_id}/variables/resolve",
    response_model=VariableResolveResponse,
)
async def resolve_variable(
    project_id: str,
    assessment_id: str = Query(..., description="Assessment id for lookup context."),
    field_name: str = Query(..., description="Variable field_name from input rows."),
    assessment_instance_id: UUID | None = Query(default=None, description="Optional assessment instance scope."),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Resolve the project variable currently backing one assessment field."""
    initiative = await require_project_viewer(db, project_id, user)
    variable = await resolve_variable_for_assessment_field(
        db,
        project_id=initiative.id,
        assessment_id=assessment_id,
        field_name=field_name,
        assessment_instance_id=assessment_instance_id,
    )
    return {"found": variable is not None, "variable": variable}


@router.post(
    "/projects/{project_id}/variables/from-chat",
    response_model=VariableResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_variable_from_chat(
    project_id: str,
    data: VariableFromChatRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Scaffold: promote a chat-approved value into the shared variable pool."""
    initiative = await require_project_editor(db, project_id, user)
    variable = await promote_chat_value_to_variable(
        db,
        initiative,
        key=data.key,
        value=data.value,
        label=data.label,
        unit=data.unit,
        value_type=data.value_type,
        chat_id=data.chat_id,
        chat_message_id=data.chat_message_id,
        quote=data.quote,
        actor=_actor_from_user(user),
    )
    if variable is None:
        raise HTTPException(status_code=400, detail="Could not promote chat value to variable")
    initiative.touch()
    await db.commit()
    await db.refresh(variable)
    return variable


@router.post(
    "/projects/{project_id}/variables",
    response_model=VariableResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_variable(
    project_id: str,
    data: VariableCreate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Create or replace a project variable."""
    initiative = await require_project_editor(db, project_id, user)
    variable, _created = await upsert_variable(
        db,
        project_id=initiative.id,
        key=data.key,
        value=data.value,
        label=data.label,
        unit=data.unit,
        value_type=data.value_type,
        source_type=data.source_type,
        source_reference=data.source_reference,
        status=data.status,
        used_in_assessments=data.used_in_assessments,
        actor=_actor_from_user(user),
        notes=data.notes,
        replace_validated=True,
    )
    initiative.touch()
    await db.commit()
    await db.refresh(variable)
    return variable


@router.post(
    "/projects/{project_id}/variables/refresh",
    response_model=VariableRefreshResponse,
)
async def refresh_variables(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Legacy bulk extraction — disabled; new variables come from finding promotion."""
    await require_project_editor(db, project_id, user)
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Variable refresh is retired. Promote chat messages to project findings to extract new variables.",
    )


@router.get("/variables/{variable_id}", response_model=VariableResponse)
async def get_variable_detail(
    variable_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Return a single variable after checking project access."""
    variable = await get_variable(db, variable_id)
    if variable is None:
        raise HTTPException(status_code=404, detail="Variable not found")
    await require_project_viewer(db, variable.project_id, user)
    return variable


@router.patch("/variables/{variable_id}", response_model=VariableResponse)
async def patch_variable(
    variable_id: UUID,
    data: VariableUpdate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Edit, confirm, or reject a project variable."""
    variable = await get_variable(db, variable_id)
    if variable is None:
        raise HTTPException(status_code=404, detail="Variable not found")
    initiative = await require_project_editor(db, variable.project_id, user)
    updates = data.model_dump(exclude_unset=True)
    updated = await update_variable(db, variable, updates, actor=_actor_from_user(user))
    initiative.touch()
    await db.commit()
    await db.refresh(updated)
    return updated


@router.delete("/variables/{variable_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_variable(
    variable_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Delete one project variable and its variable-scoped chats."""
    variable = await get_variable(db, variable_id)
    if variable is None:
        raise HTTPException(status_code=404, detail="Variable not found")
    initiative = await require_project_editor(db, variable.project_id, user)
    chats_result = await db.execute(
        select(CoreChat).where(
            CoreChat.project_id == variable.project_id,
            CoreChat.variable_id == variable.id,
        )
    )
    for chat in chats_result.scalars().all():
        await db.delete(chat)
    await delete_variable(db, variable)
    initiative.touch()
    await db.commit()
    return None


@router.get(
    "/variables/{variable_id}/comments",
    response_model=list[VariableCommentResponse],
)
async def get_variable_comments(
    variable_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List comments for one project variable."""
    variable = await get_variable(db, variable_id)
    if variable is None:
        raise HTTPException(status_code=404, detail="Variable not found")
    await require_project_viewer(db, variable.project_id, user)
    return await list_variable_comments(db, variable.id)


@router.post(
    "/variables/{variable_id}/comments",
    response_model=VariableCommentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_variable_comment(
    variable_id: UUID,
    data: VariableCommentCreate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Add a comment to one project variable."""
    variable = await get_variable(db, variable_id)
    if variable is None:
        raise HTTPException(status_code=404, detail="Variable not found")
    if not data.body.strip():
        raise HTTPException(status_code=400, detail="Comment body is required")
    project = await require_project_editor(db, variable.project_id, user)
    comment = await create_variable_comment(
        db,
        variable,
        body=data.body,
        actor=_actor_from_user(user),
    )
    project.touch()
    await db.commit()
    await db.refresh(comment)
    return comment
