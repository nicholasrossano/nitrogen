from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser, get_current_user
from app.core.database import get_db
from app.core.permissions import require_editor, require_viewer
from app.schemas.assumption import (
    AssumptionCommentCreate,
    AssumptionCommentResponse,
    AssumptionCreate,
    AssumptionRefreshResponse,
    AssumptionResponse,
    AssumptionSummary,
    AssumptionUpdate,
)
from app.services.assumptions import (
    AssumptionActor,
    build_summary,
    create_assumption_comment,
    extract_assumptions_from_sources,
    get_assumption,
    list_assumption_comments,
    list_assumptions,
    update_assumption,
    upsert_assumption,
)

router = APIRouter()


def _actor_from_user(user: AuthUser) -> AssumptionActor:
    return AssumptionActor(user_id=user.uid, email=user.email or user.uid)


@router.get(
    "/initiatives/{initiative_id}/assumptions/summary",
    response_model=AssumptionSummary,
)
async def get_assumptions_summary(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Return project-level assumptions summary counts and attention items."""
    initiative = await require_viewer(db, initiative_id, user)
    return await build_summary(db, initiative.id)


@router.get(
    "/initiatives/{initiative_id}/assumptions",
    response_model=list[AssumptionResponse],
)
async def get_assumptions(
    initiative_id: str,
    status_filter: str | None = Query(default=None, alias="status"),
    source_type: str | None = None,
    module: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List project assumptions with optional filters."""
    initiative = await require_viewer(db, initiative_id, user)
    return await list_assumptions(
        db,
        initiative.id,
        status=status_filter,
        source_type=source_type,
        module=module,
    )


@router.post(
    "/initiatives/{initiative_id}/assumptions",
    response_model=AssumptionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_assumption(
    initiative_id: str,
    data: AssumptionCreate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Create or replace a project assumption."""
    initiative = await require_editor(db, initiative_id, user)
    assumption, _created = await upsert_assumption(
        db,
        initiative_id=initiative.id,
        key=data.key,
        value=data.value,
        label=data.label,
        unit=data.unit,
        value_type=data.value_type,
        source_type=data.source_type,
        source_reference=data.source_reference,
        status=data.status,
        used_in_modules=data.used_in_modules,
        actor=_actor_from_user(user),
        notes=data.notes,
        replace_confirmed=True,
    )
    initiative.touch()
    await db.commit()
    await db.refresh(assumption)
    return assumption


@router.post(
    "/initiatives/{initiative_id}/assumptions/refresh",
    response_model=AssumptionRefreshResponse,
)
async def refresh_assumptions(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Run config-led extraction and missing placeholder generation."""
    initiative = await require_editor(db, initiative_id, user)
    created, updated, touched = await extract_assumptions_from_sources(
        db,
        initiative,
        actor=_actor_from_user(user),
    )
    initiative.touch()
    await db.commit()
    for assumption in touched:
        await db.refresh(assumption)
    return {"created": created, "updated": updated, "assumptions": touched}


@router.get("/assumptions/{assumption_id}", response_model=AssumptionResponse)
async def get_assumption_detail(
    assumption_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Return a single assumption after checking project access."""
    assumption = await get_assumption(db, assumption_id)
    if assumption is None:
        raise HTTPException(status_code=404, detail="Assumption not found")
    await require_viewer(db, assumption.initiative_id, user)
    return assumption


@router.patch("/assumptions/{assumption_id}", response_model=AssumptionResponse)
async def patch_assumption(
    assumption_id: UUID,
    data: AssumptionUpdate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Edit, confirm, or reject a project assumption."""
    assumption = await get_assumption(db, assumption_id)
    if assumption is None:
        raise HTTPException(status_code=404, detail="Assumption not found")
    initiative = await require_editor(db, assumption.initiative_id, user)
    updates = data.model_dump(exclude_unset=True)
    updated = await update_assumption(db, assumption, updates, actor=_actor_from_user(user))
    initiative.touch()
    await db.commit()
    await db.refresh(updated)
    return updated


@router.get(
    "/assumptions/{assumption_id}/comments",
    response_model=list[AssumptionCommentResponse],
)
async def get_assumption_comments(
    assumption_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List comments for one project assumption."""
    assumption = await get_assumption(db, assumption_id)
    if assumption is None:
        raise HTTPException(status_code=404, detail="Assumption not found")
    await require_viewer(db, assumption.initiative_id, user)
    return await list_assumption_comments(db, assumption.id)


@router.post(
    "/assumptions/{assumption_id}/comments",
    response_model=AssumptionCommentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_assumption_comment(
    assumption_id: UUID,
    data: AssumptionCommentCreate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Add a comment to one project assumption."""
    assumption = await get_assumption(db, assumption_id)
    if assumption is None:
        raise HTTPException(status_code=404, detail="Assumption not found")
    if not data.body.strip():
        raise HTTPException(status_code=400, detail="Comment body is required")
    initiative = await require_editor(db, assumption.initiative_id, user)
    comment = await create_assumption_comment(
        db,
        assumption,
        body=data.body,
        actor=_actor_from_user(user),
    )
    initiative.touch()
    await db.commit()
    await db.refresh(comment)
    return comment
