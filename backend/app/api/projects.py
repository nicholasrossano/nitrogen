import logging
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.config import get_settings
from app.core.database import get_db
from app.core.auth import get_current_user, AuthUser
from app.core.permissions import (
    ensure_user_exists,
    get_project_with_role,
    require_project_editor,
    require_owner,
)
from app.core.storage import get_storage
from app.models.project import Project
from app.models.assessment_instance import AssessmentInstance
from app.models.memo import MemoVersion
from app.models.evidence import EvidenceDoc
from app.models.google_drive import DriveLinkedFile
from app.models.project_share import ProjectShare
from app.models.project_material import ProjectMaterial
from app.models.user import User
from app.schemas.project import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    ProjectConfirmResponse,
)
from app.schemas.assessment_instance import AssessmentInstanceResponse
from app.assessments.registry import get_assessment_registry
from app.services import assessment_service
from app.services.assumptions import AssumptionActor, ensure_expected_assumptions
from app.services.assessment_workflow_service import is_instance_visible_in_lists
from app.services.project_overview import generate_project_overview
from app.services.workspaces import resolve_workspace_for_user

logger = logging.getLogger(__name__)

router = APIRouter()


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[-\s]+', '-', text)
    return text[:80].strip('-') or 'project'


async def _generate_unique_slug(db: AsyncSession, user_id: str, title: str | None) -> str:
    """Return a slug unique for the owner, matching the current DB constraint."""
    base = _slugify(title) if title else 'project'
    result = await db.execute(
        select(Project.slug).where(
            Project.created_by == user_id,
            Project.slug.like(f"{base}%"),
        )
    )
    existing = set(result.scalars().all())
    if base not in existing:
        return base
    counter = 2
    while f"{base}-{counter}" in existing:
        counter += 1
    return f"{base}-{counter}"


def _count_generated_assessment_instances(instances: list[AssessmentInstance]) -> int:
    """Instances marked complete via final approval, excluding trash."""
    return sum(
        1
        for inst in instances
        if not inst.archived and inst.is_plan_complete
    )


def _count_active_assessment_instances(instances: list[AssessmentInstance]) -> int:
    """Assessment instances started for this initiative, excluding trash."""
    return sum(1 for inst in instances if not inst.archived)


def _active_assessment_instances(instances: list[AssessmentInstance]) -> list[AssessmentInstance]:
    """Return only non-archived assessment instances."""
    return [inst for inst in instances if not inst.archived]


def _project_to_response(initiative: Project, shared_role: str | None = None, owner_email: str | None = None) -> dict:
    """Convert an Project ORM object to a response dict with sharing fields.

    Computes ``deliverables`` and ``tool_alignments`` from assessment_instances
    (single source of truth).  The JSONB columns on the initiative are ignored.
    """
    data = ProjectResponse.model_validate(initiative).model_dump()

    all_instances = initiative.assessment_instances or []
    instances = _active_assessment_instances(all_instances)

    deliverables: dict = {}
    alignments: dict = {}
    deliverables_ts: dict = {}
    alignments_ts: dict = {}

    for inst in instances:
        if inst.deliverable and inst.is_plan_complete:
            prev = deliverables_ts.get(inst.assessment_id)
            if prev is None or inst.updated_at > prev:
                deliverables[inst.assessment_id] = inst.deliverable
                deliverables_ts[inst.assessment_id] = inst.updated_at
        if inst.alignment:
            prev = alignments_ts.get(inst.assessment_id)
            if prev is None or inst.updated_at > prev:
                alignments[inst.assessment_id] = inst.alignment
                alignments_ts[inst.assessment_id] = inst.updated_at

    data["deliverables"] = deliverables or None
    data["assessment_alignments"] = alignments or None
    data["assessment_instances_count"] = _count_active_assessment_instances(instances)
    data["generated_assessments_count"] = _count_generated_assessment_instances(instances)
    data["assessment_instances"] = [
        AssessmentInstanceResponse.model_validate(i).model_dump()
        for i in instances
    ]
    data["shared_role"] = shared_role
    data["owner_email"] = owner_email
    return data


def _project_to_list_item(initiative: Project, shared_role: str | None = None, owner_email: str | None = None) -> dict:
    """Lightweight version for list endpoints — skips heavy fields."""
    data = ProjectResponse.model_validate(initiative).model_dump()
    # Derive a simple deliverable count without iterating assessment instances
    instances = _active_assessment_instances(initiative.assessment_instances or [])
    seen_tools: set[str] = set()
    for inst in instances:
        if inst.deliverable and inst.is_plan_complete:
            seen_tools.add(inst.assessment_id)
    data["deliverables"] = {t: True for t in seen_tools} if seen_tools else None
    data["assessment_instances_count"] = _count_active_assessment_instances(instances)
    data["generated_assessments_count"] = _count_generated_assessment_instances(instances)
    data["tool_alignments"] = None
    data["tool_inputs"] = None
    data["project_plan"] = None
    data["assessment_instances"] = None
    data["shared_role"] = shared_role
    data["owner_email"] = owner_email
    return data


def _safe_append_list_item(
    results: list[dict],
    initiative: Project,
    shared_role: str | None = None,
    owner_email: str | None = None,
) -> None:
    """Append a list item while preventing one malformed row from failing the full response."""
    try:
        results.append(
            _project_to_list_item(
                initiative,
                shared_role=shared_role,
                owner_email=owner_email,
            )
        )
    except Exception:
        logger.exception(
            "Failed to serialize initiative %s for list response; skipping row",
            initiative.id,
        )


def _humanize_assessment_id(assessment_id: str) -> str:
    return assessment_id.replace("_", " ").strip() or "Assessment"


def _creator_handle_from_instance(inst: AssessmentInstance, email_map: dict[str, str]) -> str:
    email = email_map.get(inst.started_by) or ""
    email_local = email.split("@", 1)[0].strip().lower()
    if email_local:
        return email_local

    fallback = re.sub(r"[^\w.-]", "_", inst.started_by).strip("._").lower()
    return fallback or "user"


def _resolve_assessment_name(assessment_id: str) -> str:
    assessment = get_assessment_registry().get_assessment(assessment_id)
    if assessment is not None:
        return assessment.definition.name
    return _humanize_assessment_id(assessment_id)


def _serialize_assessment_instance(
    inst: AssessmentInstance,
    *,
    email_map: dict[str, str],
    assessment_names: dict[str, str],
) -> dict:
    data = AssessmentInstanceResponse.model_validate(inst).model_dump()
    started_by_email = email_map.get(inst.started_by)
    creator_handle = _creator_handle_from_instance(inst, email_map)
    assessment_name = assessment_names.get(inst.assessment_id) or _humanize_assessment_id(inst.assessment_id)
    display_name = f"{assessment_name} #{inst.instance_number} · @{creator_handle}"

    data["started_by_email"] = started_by_email
    data["instance_number"] = inst.instance_number
    data["creator_handle"] = creator_handle
    data["display_name"] = display_name
    return data


async def _serialize_assessment_instances(
    db: AsyncSession,
    instances: list[AssessmentInstance],
) -> list[dict]:
    if not instances:
        return []

    uids = list({i.started_by for i in instances})
    email_map: dict[str, str] = {}
    if uids:
        rows = await db.execute(select(User.id, User.email).where(User.id.in_(uids)))
        email_map = {row.id: row.email for row in rows if row.email}

    unique_assessment_ids = {inst.assessment_id for inst in instances}
    assessment_names = {assessment_id: _resolve_assessment_name(assessment_id) for assessment_id in unique_assessment_ids}
    return [
        _serialize_assessment_instance(
            inst,
            email_map=email_map,
            assessment_names=assessment_names,
        )
        for inst in instances
    ]


@router.post("/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    data: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Create a new initiative and start the intake process"""
    await ensure_user_exists(db, user)
    workspace, _membership = await resolve_workspace_for_user(db, user.uid, data.workspace_id)
    slug = await _generate_unique_slug(db, user.uid, data.title)
    initiative = Project(
        user_id=user.uid,
        workspace_id=workspace.id,
        title=data.title,
        slug=slug,
    )
    db.add(initiative)
    await db.commit()
    await db.refresh(initiative)

    owner_user = await db.get(User, initiative.user_id)
    owner_email = owner_user.email if owner_user else None
    return _project_to_response(initiative, shared_role=None, owner_email=owner_email)


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Get an initiative by canonical UUID (owner, editor, or viewer)."""
    await ensure_user_exists(db, user)
    initiative, role = await get_project_with_role(db, project_id, user)

    owner_user = await db.get(User, initiative.user_id)
    owner_email = owner_user.email if owner_user else None

    return _project_to_response(
        initiative,
        shared_role=role if role != "owner" else None,
        owner_email=owner_email,
    )


@router.post("/projects/{project_id}/confirm", response_model=ProjectConfirmResponse)
async def confirm_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Confirm the intake stage and move to evidence stage"""
    initiative = await require_project_editor(db, project_id, user)
    
    if not initiative.is_intake_complete():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot confirm: required fields are not complete",
        )
    
    initiative.stage_1_complete = True
    initiative.stage = "evidence"
    await db.commit()
    
    return ProjectConfirmResponse(
        success=True,
        stage="evidence",
        message="Project confirmed. Ready for evidence upload.",
    )


@router.get("/projects", response_model=list[ProjectResponse])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
    limit: int = 20,
    offset: int = 0,
    archived: bool = False,
    workspace_id: str | None = None,
):
    """List initiatives for the selected workspace."""
    await ensure_user_exists(db, user)
    workspace, _membership = await resolve_workspace_for_user(db, user.uid, workspace_id)

    workspace_projects = await db.execute(
        select(Project)
        .where(
            Project.workspace_id == workspace.id,
            Project.archived == archived,
        )
        .order_by(Project.updated_at.desc(), Project.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    initiatives = workspace_projects.scalars().all()

    # Legacy project shares stay visible from the personal workspace so existing
    # collaboration links do not disappear while workspaces become the default.
    shared_initiatives: list[tuple[Project, str, str | None]] = []
    if not archived and workspace.workspace_type == "personal":
        shared_result = await db.execute(
            select(ProjectShare, Project, User)
            .join(Project, ProjectShare.project_id == Project.id)
            .outerjoin(User, Project.user_id == User.id)
            .where(
                ProjectShare.user_id == user.uid,
                Project.archived == False,  # noqa: E712
                Project.workspace_id != workspace.id,
            )
            .order_by(Project.updated_at.desc())
            .limit(limit)
        )
        shared_initiatives = [
            (initiative, share.role, owner.email if owner else None)
            for share, initiative, owner in shared_result.all()
        ]

    results = []
    for init in initiatives:
        _safe_append_list_item(results, init, owner_email=user.email)

    for init, role, owner_email in shared_initiatives:
        _safe_append_list_item(
            results,
            init,
            shared_role=role,
            owner_email=owner_email,
        )

    results.sort(key=lambda x: x["updated_at"], reverse=True)
    return results


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Update an initiative (title, icon, workspace). Owner or editor."""
    await ensure_user_exists(db, user)
    initiative, role = await get_project_with_role(db, project_id, user)
    if role == "viewer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Viewers cannot modify this project",
        )

    if data.title is not None:
        initiative.title = data.title
    if data.icon is not None:
        initiative.icon = data.icon
    if data.subject is not None:
        initiative.subject = data.subject
    if data.sector is not None:
        initiative.sector = data.sector
    if data.geography is not None:
        initiative.geography = data.geography
    if data.target_population is not None:
        initiative.target_population = data.target_population
    if data.goal is not None:
        initiative.goal = data.goal
    if data.budget_range is not None:
        initiative.budget_range = data.budget_range
    if data.timeline is not None:
        initiative.timeline = data.timeline
    if data.constraints is not None:
        initiative.constraints = data.constraints
    if data.archived is not None:
        initiative.archived = data.archived
    if data.workspace_id is not None:
        if role != "owner":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only project owners can move a project between workspaces",
            )
        workspace, _membership = await resolve_workspace_for_user(db, user.uid, data.workspace_id)
        initiative.workspace_id = workspace.id
        await db.execute(
            update(ProjectMaterial)
            .where(ProjectMaterial.project_id == initiative.id)
            .values(workspace_id=workspace.id)
        )
        await db.execute(
            update(EvidenceDoc)
            .where(EvidenceDoc.project_id == initiative.id)
            .values(workspace_id=workspace.id)
        )
        await db.execute(
            update(DriveLinkedFile)
            .where(DriveLinkedFile.project_id == initiative.id)
            .values(workspace_id=workspace.id)
        )

    await db.commit()
    await db.refresh(initiative)

    owner_user = await db.get(User, initiative.user_id)
    owner_email = owner_user.email if owner_user else None
    return _project_to_response(
        initiative,
        shared_role=role if role != "owner" else None,
        owner_email=owner_email,
    )


@router.post("/projects/{project_id}/overview", response_model=ProjectResponse)
async def generate_overview(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Generate or refresh the stored initiative overview description."""
    await ensure_user_exists(db, user)
    initiative, role = await get_project_with_role(db, project_id, user)
    if role == "viewer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Viewers cannot refresh this overview",
        )

    try:
        initiative.overview_description = await generate_project_overview(db, initiative, user.uid)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    initiative.overview_generated_at = datetime.now(timezone.utc)
    initiative.touch()
    await db.commit()
    await db.refresh(initiative)

    owner_user = await db.get(User, initiative.user_id)
    owner_email = owner_user.email if owner_user else None
    return _project_to_response(
        initiative,
        shared_role=role if role != "owner" else None,
        owner_email=owner_email,
    )


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Archive (soft delete) an initiative - owner only"""
    initiative = await require_owner(db, project_id, user)
    initiative.archived = True
    await db.commit()
    return None


@router.post("/projects/{project_id}/restore", response_model=ProjectResponse)
async def restore_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Restore an archived initiative from trash - owner only"""
    initiative = await require_owner(db, project_id, user)
    
    if not initiative.archived:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project is not archived",
        )
    
    initiative.archived = False
    await db.commit()
    await db.refresh(initiative)

    owner_user = await db.get(User, initiative.user_id)
    owner_email = owner_user.email if owner_user else None
    return _project_to_response(initiative, shared_role=None, owner_email=owner_email)


@router.get(
    "/projects/{project_id}/assessments",
    response_model=list[AssessmentInstanceResponse],
)
async def list_assessment_instances(
    project_id: str,
    archived: bool = False,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List assessment instances for a project. Pass ?archived=true for the trash view."""
    await ensure_user_exists(db, user)
    initiative, _role = await get_project_with_role(db, project_id, user)
    instances = await assessment_service.list_instances(db, initiative.id, archived=archived)
    visible_instances = [inst for inst in instances if is_instance_visible_in_lists(inst)]
    return await _serialize_assessment_instances(db, visible_instances)


@router.delete(
    "/projects/{project_id}/assessments/{instance_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def archive_assessment_instance(
    project_id: str,
    instance_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Soft-delete (trash) a assessment instance — editor or owner."""
    await ensure_user_exists(db, user)
    initiative = await require_project_editor(db, project_id, user)
    inst = await db.get(AssessmentInstance, instance_id)
    if inst is None or inst.project_id != initiative.id:
        raise HTTPException(status_code=404, detail="Assessment instance not found")
    inst.archived = True
    await db.commit()
    return None


@router.post(
    "/projects/{project_id}/assessments/{instance_id}/restore",
    response_model=AssessmentInstanceResponse,
)
async def restore_assessment_instance(
    project_id: str,
    instance_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Restore a trashed assessment instance."""
    await ensure_user_exists(db, user)
    initiative = await require_project_editor(db, project_id, user)
    inst = await db.get(AssessmentInstance, instance_id)
    if inst is None or inst.project_id != initiative.id:
        raise HTTPException(status_code=404, detail="Assessment instance not found")
    inst.archived = False
    await db.commit()
    await db.refresh(inst)
    serialized = await _serialize_assessment_instances(db, [inst])
    return serialized[0]


@router.delete(
    "/projects/{project_id}/assessments/{instance_id}/permanent",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def permanently_delete_assessment_instance(
    project_id: str,
    instance_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Permanently delete a assessment instance. Irreversible."""
    await ensure_user_exists(db, user)
    initiative = await require_project_editor(db, project_id, user)
    inst = await db.get(AssessmentInstance, instance_id)
    if inst is None or inst.project_id != initiative.id:
        raise HTTPException(status_code=404, detail="Assessment instance not found")
    await db.delete(inst)
    await db.commit()
    return None


class CreateAssessmentInstanceBody(BaseModel):
    assessment_id: str


@router.post(
    "/projects/{project_id}/assessments",
    response_model=AssessmentInstanceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_assessment_instance(
    project_id: str,
    body: CreateAssessmentInstanceBody,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Create a fresh assessment instance directly (no chat session required)."""
    await ensure_user_exists(db, user)
    initiative = await require_project_editor(db, project_id, user)
    inst = await assessment_service.get_or_create_instance(
        db, initiative.id, body.assessment_id, user.uid
        # no chat_id → always creates a fresh instance
    )
    await ensure_expected_assumptions(
        db,
        initiative,
        assessment_ids=[body.assessment_id],
        actor=AssumptionActor(user_id=user.uid, email=user.email or user.uid),
    )
    await db.commit()
    await db.refresh(inst)
    serialized = await _serialize_assessment_instances(db, [inst])
    return serialized[0]


@router.delete("/projects/{project_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
async def permanently_delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Permanently delete an initiative and all related data - owner only"""
    initiative = await require_owner(db, project_id, user)

    # Collect export file paths before CASCADE deletes the rows
    memo_result = await db.execute(
        select(MemoVersion.export_path)
        .where(
            MemoVersion.project_id == initiative.id,
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
        logger.warning("Failed to clean up uploads for initiative %s", project_id, exc_info=True)

    try:
        exports_storage = get_storage()
        for path in export_paths:
            await exports_storage.delete(path)
    except Exception:
        logger.warning("Failed to clean up exports for initiative %s", project_id, exc_info=True)

    return None
