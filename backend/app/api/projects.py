import logging
import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.initiatives import _generate_unique_slug
from app.core.auth import AuthUser, get_current_user
from app.core.database import get_db
from app.core.permissions import (
    ensure_user_exists,
    get_project_with_role,
    require_owner,
    require_project_editor,
)
from app.models.project import Project
from app.models.project_share import ProjectShare
from app.models.user import User
from app.schemas.project import ProjectCreate, ProjectResponse, ProjectUpdate
from app.services.workspaces import resolve_workspace_for_user

logger = logging.getLogger(__name__)

router = APIRouter()


def _project_to_response(
    project: Project,
    *,
    shared_role: str | None = None,
    owner_email: str | None = None,
) -> dict:
    data = ProjectResponse.model_validate(project).model_dump()
    data["shared_role"] = shared_role
    data["owner_email"] = owner_email
    return data


def _safe_append_project(
    results: list[dict],
    project: Project,
    *,
    shared_role: str | None = None,
    owner_email: str | None = None,
) -> None:
    try:
        results.append(
            _project_to_response(
                project,
                shared_role=shared_role,
                owner_email=owner_email,
            )
        )
    except Exception:
        logger.exception(
            "Failed to serialize project %s for list response; skipping row",
            project.id,
        )


@router.get("/projects")
async def list_projects(
    limit: int = 20,
    offset: int = 0,
    archived: bool = False,
    workspace_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List projects for the selected workspace.

    Workspace members see all projects in that workspace (same rules as /initiatives).
    """
    await ensure_user_exists(db, user)
    workspace, _membership = await resolve_workspace_for_user(
        db,
        user.uid,
        uuid.UUID(workspace_id) if workspace_id else None,
    )

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
    projects = workspace_projects.scalars().all()

    shared_projects: list[tuple[Project, str, str | None]] = []
    if not archived and workspace.workspace_type == "personal":
        shared_result = await db.execute(
            select(ProjectShare, Project, User)
            .join(Project, ProjectShare.project_id == Project.id)
            .outerjoin(User, Project.created_by == User.id)
            .where(
                ProjectShare.user_id == user.uid,
                Project.archived == False,  # noqa: E712
                Project.workspace_id != workspace.id,
            )
            .order_by(Project.updated_at.desc())
            .limit(limit)
        )
        shared_projects = [
            (project, share.role, owner.email if owner else None)
            for share, project, owner in shared_result.all()
        ]

    results: list[dict] = []
    for project in projects:
        owner = await db.get(User, project.created_by)
        _safe_append_project(
            results,
            project,
            owner_email=owner.email if owner else None,
        )

    for project, role, owner_email in shared_projects:
        _safe_append_project(
            results,
            project,
            shared_role=role,
            owner_email=owner_email,
        )

    results.sort(key=lambda item: item["updated_at"], reverse=True)
    return results


@router.post("/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    data: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    await ensure_user_exists(db, user)
    workspace, _ = await resolve_workspace_for_user(db, user.uid, data.workspace_id)
    slug = await _generate_unique_slug(db, user.uid, data.title)
    project = Project(
        created_by=user.uid,
        workspace_id=workspace.id,
        name=data.title,
        slug=slug,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    owner = await db.get(User, user.uid)
    return _project_to_response(project, owner_email=owner.email if owner else None)


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    await ensure_user_exists(db, user)
    project, role = await get_project_with_role(db, project_id, user)
    owner = await db.get(User, project.created_by)
    return _project_to_response(
        project,
        shared_role=role if role != "owner" else None,
        owner_email=owner.email if owner else None,
    )


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    await require_project_editor(db, project_id, user)
    project, role = await get_project_with_role(db, project_id, user)

    if data.title is not None:
        project.name = data.title
    if data.subject is not None:
        project.subject = data.subject
    if data.icon is not None:
        project.icon = data.icon
    if data.archived is not None:
        project.archived = data.archived

    project.touch()
    await db.commit()
    await db.refresh(project)
    owner = await db.get(User, project.created_by)
    return _project_to_response(
        project,
        shared_role=role if role != "owner" else None,
        owner_email=owner.email if owner else None,
    )


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    project = await require_owner(db, project_id, user)
    project.archived = True
    project.touch()
    await db.commit()
