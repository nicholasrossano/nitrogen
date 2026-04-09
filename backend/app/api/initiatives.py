import logging
import re
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import get_settings
from app.core.database import get_db
from app.core.auth import get_current_user, AuthUser
from app.core.permissions import (
    ensure_user_exists,
    get_initiative_with_role,
    require_editor,
    require_owner,
)
from app.core.storage import get_storage
from app.models.initiative import Initiative
from app.models.module_instance import ModuleInstance
from app.models.onboarding import ChatMessage
from app.models.memo import MemoVersion
from app.models.project_share import ProjectShare
from app.models.user import User
from app.schemas.initiative import (
    InitiativeCreate,
    InitiativeUpdate,
    InitiativeResponse,
    InitiativeConfirmResponse,
)
from app.schemas.module_instance import ModuleInstanceResponse
from app.services import module_service

logger = logging.getLogger(__name__)

router = APIRouter()


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[-\s]+', '-', text)
    return text[:80].strip('-') or 'project'


async def _generate_unique_slug(db: AsyncSession, user_id: str, title: str | None) -> str:
    """Return a slug unique within the user's namespace."""
    base = _slugify(title) if title else 'project'
    result = await db.execute(
        select(Initiative.slug).where(
            Initiative.user_id == user_id,
            Initiative.slug.like(f"{base}%"),
        )
    )
    existing = set(result.scalars().all())
    if base not in existing:
        return base
    counter = 2
    while f"{base}-{counter}" in existing:
        counter += 1
    return f"{base}-{counter}"


def _count_generated_module_instances(instances: list[ModuleInstance]) -> int:
    """Instances that finished generation (complete + deliverable), excluding trash."""
    return sum(
        1
        for inst in instances
        if not inst.archived and inst.status == "complete" and inst.deliverable
    )


def _initiative_to_response(initiative: Initiative, shared_role: str | None = None, owner_email: str | None = None) -> dict:
    """Convert an Initiative ORM object to a response dict with sharing fields.

    Computes ``deliverables`` and ``tool_alignments`` from module_instances
    (single source of truth).  The JSONB columns on the initiative are ignored.
    """
    data = InitiativeResponse.model_validate(initiative).model_dump()

    instances = initiative.module_instances or []

    deliverables: dict = {}
    alignments: dict = {}
    deliverables_ts: dict = {}
    alignments_ts: dict = {}

    for inst in instances:
        if inst.deliverable and inst.status == "complete":
            prev = deliverables_ts.get(inst.module_id)
            if prev is None or inst.updated_at > prev:
                deliverables[inst.module_id] = inst.deliverable
                deliverables_ts[inst.module_id] = inst.updated_at
        if inst.alignment:
            prev = alignments_ts.get(inst.module_id)
            if prev is None or inst.updated_at > prev:
                alignments[inst.module_id] = inst.alignment
                alignments_ts[inst.module_id] = inst.updated_at

    data["deliverables"] = deliverables or None
    data["module_alignments"] = alignments or None
    data["generated_modules_count"] = _count_generated_module_instances(instances)
    data["module_instances"] = [
        ModuleInstanceResponse.model_validate(i).model_dump()
        for i in instances
    ]
    data["shared_role"] = shared_role
    data["owner_email"] = owner_email
    return data


def _initiative_to_list_item(initiative: Initiative, shared_role: str | None = None, owner_email: str | None = None) -> dict:
    """Lightweight version for list endpoints — skips heavy fields."""
    data = InitiativeResponse.model_validate(initiative).model_dump()
    # Derive a simple deliverable count without iterating module instances
    instances = initiative.module_instances or []
    seen_tools: set[str] = set()
    for inst in instances:
        if inst.deliverable and inst.status == "complete":
            seen_tools.add(inst.module_id)
    data["deliverables"] = {t: True for t in seen_tools} if seen_tools else None
    data["generated_modules_count"] = _count_generated_module_instances(instances)
    data["tool_alignments"] = None
    data["tool_inputs"] = None
    data["project_plan"] = None
    data["module_instances"] = None
    data["shared_role"] = shared_role
    data["owner_email"] = owner_email
    return data


@router.post("/initiatives", response_model=InitiativeResponse, status_code=status.HTTP_201_CREATED)
async def create_initiative(
    data: InitiativeCreate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Create a new initiative and start the intake process"""
    await ensure_user_exists(db, user)
    slug = await _generate_unique_slug(db, user.uid, data.title)
    initiative = Initiative(
        user_id=user.uid,
        title=data.title,
        slug=slug,
    )
    db.add(initiative)
    await db.commit()
    await db.refresh(initiative)
    
    initial_message = ChatMessage(
        initiative_id=initiative.id,
        role="assistant",
        content="Briefly describe your project.",
    )
    db.add(initial_message)
    await db.commit()
    await db.refresh(initiative)

    owner_user = await db.get(User, initiative.user_id)
    owner_email = owner_user.email if owner_user else None
    return _initiative_to_response(initiative, shared_role=None, owner_email=owner_email)


@router.get("/initiatives/{initiative_id}", response_model=InitiativeResponse)
async def get_initiative(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Get an initiative by canonical UUID (owner, editor, or viewer)."""
    await ensure_user_exists(db, user)
    initiative, role = await get_initiative_with_role(db, initiative_id, user)

    owner_user = await db.get(User, initiative.user_id)
    owner_email = owner_user.email if owner_user else None

    return _initiative_to_response(
        initiative,
        shared_role=role if role != "owner" else None,
        owner_email=owner_email,
    )


@router.post("/initiatives/{initiative_id}/confirm", response_model=InitiativeConfirmResponse)
async def confirm_initiative(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Confirm the intake stage and move to evidence stage"""
    initiative = await require_editor(db, initiative_id, user)
    
    if not initiative.is_intake_complete():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot confirm: required fields are not complete",
        )
    
    initiative.stage_1_complete = True
    initiative.stage = "evidence"
    await db.commit()
    
    confirm_message = ChatMessage(
        initiative_id=initiative.id,
        role="assistant",
        content="Great! Your initiative is confirmed. Now let's add some supporting evidence. You can upload a document or paste text.",
        widget_type="evidence_input",
        widget_data={"status": "ready"},
    )
    db.add(confirm_message)
    await db.commit()
    
    return InitiativeConfirmResponse(
        success=True,
        stage="evidence",
        message="Initiative confirmed. Ready for evidence upload.",
    )


@router.get("/initiatives", response_model=list[InitiativeResponse])
async def list_initiatives(
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    limit: int = 20,
    offset: int = 0,
    archived: bool = False,
):
    """List owned + shared initiatives for the current user."""
    await ensure_user_exists(db, user)

    # Owned initiatives
    owned = await db.execute(
        select(Initiative)
        .where(
            Initiative.user_id == user.uid,
            Initiative.archived == archived,
        )
        .order_by(Initiative.updated_at.desc(), Initiative.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    owned_initiatives = owned.scalars().all()

    # Shared initiatives (only non-archived, and only when not viewing trash)
    shared_initiatives: list[tuple[Initiative, str, str | None]] = []
    if not archived:
        shared_result = await db.execute(
            select(ProjectShare, Initiative, User)
            .join(Initiative, ProjectShare.initiative_id == Initiative.id)
            .outerjoin(User, Initiative.user_id == User.id)
            .where(
                ProjectShare.user_id == user.uid,
                Initiative.archived == False,  # noqa: E712
            )
            .order_by(Initiative.updated_at.desc())
            .limit(limit)
        )
        shared_initiatives = [
            (initiative, share.role, owner.email if owner else None)
            for share, initiative, owner in shared_result.all()
        ]

    results = []
    for init in owned_initiatives:
        results.append(_initiative_to_list_item(init, owner_email=user.email))

    for init, role, owner_email in shared_initiatives:
        results.append(_initiative_to_list_item(init, shared_role=role, owner_email=owner_email))

    results.sort(key=lambda x: x["updated_at"], reverse=True)
    return results


@router.patch("/initiatives/{initiative_id}", response_model=InitiativeResponse)
async def update_initiative(
    initiative_id: str,
    data: InitiativeUpdate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Update an initiative (title, icon). Owner or editor."""
    await ensure_user_exists(db, user)
    initiative, role = await get_initiative_with_role(db, initiative_id, user)
    if role == "viewer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Viewers cannot modify this project",
        )

    if data.title is not None:
        initiative.title = data.title
    if data.icon is not None:
        initiative.icon = data.icon

    await db.commit()
    await db.refresh(initiative)

    owner_user = await db.get(User, initiative.user_id)
    owner_email = owner_user.email if owner_user else None
    return _initiative_to_response(
        initiative,
        shared_role=role if role != "owner" else None,
        owner_email=owner_email,
    )


@router.delete("/initiatives/{initiative_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_initiative(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Archive (soft delete) an initiative - owner only"""
    initiative = await require_owner(db, initiative_id, user)
    initiative.archived = True
    await db.commit()
    return None


@router.post("/initiatives/{initiative_id}/restore", response_model=InitiativeResponse)
async def restore_initiative(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Restore an archived initiative from trash - owner only"""
    initiative = await require_owner(db, initiative_id, user)
    
    if not initiative.archived:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Initiative is not archived",
        )
    
    initiative.archived = False
    await db.commit()
    await db.refresh(initiative)

    owner_user = await db.get(User, initiative.user_id)
    owner_email = owner_user.email if owner_user else None
    return _initiative_to_response(initiative, shared_role=None, owner_email=owner_email)


@router.get(
    "/initiatives/{initiative_id}/modules",
    response_model=list[ModuleInstanceResponse],
)
async def list_module_instances(
    initiative_id: str,
    archived: bool = False,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List module instances for a project. Pass ?archived=true for the trash view."""
    await ensure_user_exists(db, user)
    initiative, _role = await get_initiative_with_role(db, initiative_id, user)
    instances = await module_service.list_instances(db, initiative.id, archived=archived)

    # Resolve user emails in a single query
    uids = list({i.started_by for i in instances})
    email_map: dict[str, str] = {}
    if uids:
        rows = await db.execute(select(User.id, User.email).where(User.id.in_(uids)))
        email_map = {row.id: row.email for row in rows if row.email}

    result = []
    for inst in instances:
        data = ModuleInstanceResponse.model_validate(inst).model_dump()
        data["started_by_email"] = email_map.get(inst.started_by)
        result.append(data)
    return result


@router.delete(
    "/initiatives/{initiative_id}/modules/{instance_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def archive_module_instance(
    initiative_id: str,
    instance_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Soft-delete (trash) a module instance — editor or owner."""
    await ensure_user_exists(db, user)
    initiative = await require_editor(db, initiative_id, user)
    inst = await db.get(ModuleInstance, instance_id)
    if inst is None or inst.initiative_id != initiative.id:
        raise HTTPException(status_code=404, detail="Module instance not found")
    inst.archived = True
    await db.commit()
    return None


@router.post(
    "/initiatives/{initiative_id}/modules/{instance_id}/restore",
    response_model=ModuleInstanceResponse,
)
async def restore_module_instance(
    initiative_id: str,
    instance_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Restore a trashed module instance."""
    await ensure_user_exists(db, user)
    initiative = await require_editor(db, initiative_id, user)
    inst = await db.get(ModuleInstance, instance_id)
    if inst is None or inst.initiative_id != initiative.id:
        raise HTTPException(status_code=404, detail="Module instance not found")
    inst.archived = False
    await db.commit()
    await db.refresh(inst)
    return inst


@router.delete(
    "/initiatives/{initiative_id}/modules/{instance_id}/permanent",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def permanently_delete_module_instance(
    initiative_id: str,
    instance_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Permanently delete a module instance. Irreversible."""
    await ensure_user_exists(db, user)
    initiative = await require_editor(db, initiative_id, user)
    inst = await db.get(ModuleInstance, instance_id)
    if inst is None or inst.initiative_id != initiative.id:
        raise HTTPException(status_code=404, detail="Module instance not found")
    await db.delete(inst)
    await db.commit()
    return None


class CreateModuleInstanceBody(BaseModel):
    module_id: str


@router.post(
    "/initiatives/{initiative_id}/modules",
    response_model=ModuleInstanceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_module_instance(
    initiative_id: str,
    body: CreateModuleInstanceBody,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Create a fresh module instance directly (no chat session required)."""
    await ensure_user_exists(db, user)
    initiative = await require_editor(db, initiative_id, user)
    inst = await module_service.get_or_create_instance(
        db, initiative.id, body.module_id, user.uid
        # no session_id → always creates a fresh instance
    )
    await db.commit()
    await db.refresh(inst)
    return inst


@router.delete("/initiatives/{initiative_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
async def permanently_delete_initiative(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Permanently delete an initiative and all related data - owner only"""
    initiative = await require_owner(db, initiative_id, user)

    # Collect export file paths before CASCADE deletes the rows
    memo_result = await db.execute(
        select(MemoVersion.export_path)
        .where(
            MemoVersion.initiative_id == initiative.id,
            MemoVersion.export_path.isnot(None),
        )
    )
    export_paths = [p for p in memo_result.scalars().all() if p]

    await db.delete(initiative)
    await db.commit()

    # Clean up storage blobs (best-effort, don't fail the request)
    settings = get_settings()
    try:
        uploads_dir = Path(settings.uploads_dir) / str(initiative.id)
        if uploads_dir.exists():
            shutil.rmtree(uploads_dir, ignore_errors=True)
    except Exception:
        logger.warning("Failed to clean up uploads for initiative %s", initiative_id, exc_info=True)

    try:
        exports_storage = get_storage()
        for path in export_paths:
            await exports_storage.delete(path)
    except Exception:
        logger.warning("Failed to clean up exports for initiative %s", initiative_id, exc_info=True)

    return None
