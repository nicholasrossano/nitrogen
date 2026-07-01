import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.auth import AuthUser
from app.models.project import Project
from app.models.project_share import ProjectShare
from app.models.user import User
from app.models.workspace import WorkspaceRole
from app.services.pending_invitations import redeem_pending_invitations
from app.services.workspaces import (
    ensure_company_workspace,
    ensure_personal_workspace,
    get_workspace_membership,
    require_workspace_member as _require_workspace_member,
    require_workspace_owner as _require_workspace_owner,
)


_LAST_SEEN_THROTTLE_SECONDS = 300  # only update last_seen_at every 5 minutes


async def ensure_user_exists(db: AsyncSession, user: AuthUser) -> None:
    """Upsert the authenticated user into the users table."""
    if not user.uid or user.uid == "shared-user":
        return
    settings = get_settings()
    existing = await db.get(User, user.uid)
    now = datetime.now(timezone.utc)
    if existing:
        if user.email:
            existing.email = user.email
        if (
            existing.last_seen_at is None
            or (now - existing.last_seen_at).total_seconds()
            > _LAST_SEEN_THROTTLE_SECONDS
        ):
            existing.last_seen_at = now
        if settings.single_org_mode:
            await ensure_company_workspace(db, user.uid)
        else:
            await ensure_personal_workspace(db, user.uid)
        redeem_email = user.email or existing.email
        await redeem_pending_invitations(
            db, user.uid, redeem_email, email_verified=user.email_verified
        )
        await db.commit()
    else:
        db.add(
            User(
                id=user.uid,
                email=user.email,
                last_seen_at=now,
            )
        )
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            existing = await db.get(User, user.uid)
            if existing is None:
                raise
        if settings.single_org_mode:
            await ensure_company_workspace(db, user.uid)
        else:
            await ensure_personal_workspace(db, user.uid)
        await redeem_pending_invitations(
            db, user.uid, user.email, email_verified=user.email_verified
        )
        await db.commit()


async def _get_role_for_project(
    db: AsyncSession,
    project: Project,
    user: AuthUser,
) -> str | None:
    """Resolve the current user's role for a concrete project."""
    settings = get_settings()
    if settings.single_org_mode and project.workspace_id:
        membership = await get_workspace_membership(
            db, project.workspace_id, user.uid
        )
        if membership:
            if membership.role == WorkspaceRole.OWNER.value:
                return "owner"
            return "editor"

    if project.user_id == user.uid or project.created_by == user.uid:
        return "owner"

    share_result = await db.execute(
        select(ProjectShare).where(
            ProjectShare.project_id == project.id,
            ProjectShare.user_id == user.uid,
        )
    )
    share = share_result.scalar_one_or_none()
    if share:
        return share.role

    return None


def project_access_filter(user_id: str):
    """SQLAlchemy filter: projects the user created or was explicitly shared into."""
    shared_project_ids = select(ProjectShare.project_id).where(
        ProjectShare.user_id == user_id
    )
    return or_(
        Project.created_by == user_id,
        Project.id.in_(shared_project_ids),
    )


async def get_project_with_role(
    db: AsyncSession,
    project_id: uuid.UUID | str,
    user: AuthUser,
) -> tuple[Project, str]:
    """Return (project, role) where role is 'owner', 'editor', or 'viewer."""
    try:
        uid = uuid.UUID(str(project_id))
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    result = await db.execute(select(Project).where(Project.id == uid))
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    role = await _get_role_for_project(db, project, user)
    if role:
        return project, role
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
    )


async def require_project_editor(
    db: AsyncSession,
    project_id: uuid.UUID | str,
    user: AuthUser,
) -> Project:
    """Return project if the user is owner or editor, else 403."""
    project, role = await get_project_with_role(db, project_id, user)
    if role == "viewer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Viewers cannot modify this project",
        )
    return project


async def require_owner(
    db: AsyncSession,
    project_id: uuid.UUID | str,
    user: AuthUser,
) -> Project:
    """Return project if the user is the project creator."""
    project, role = await get_project_with_role(db, project_id, user)
    if role == "owner":
        return project
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN, detail="You cannot manage this project"
    )


async def require_project_viewer(
    db: AsyncSession,
    project_id: uuid.UUID | str,
    user: AuthUser,
) -> Project:
    """Return project if the user has any access (owner/editor/viewer)."""
    project, _role = await get_project_with_role(db, project_id, user)
    return project


# Deprecated aliases — remove after frontend cutover completes.
get_initiative_with_role = get_project_with_role
require_editor = require_project_editor
require_viewer = require_project_viewer


async def require_workspace_member(
    db: AsyncSession, workspace_id: uuid.UUID | str, user: AuthUser
):
    """Return membership if the current user belongs to the workspace."""
    return await _require_workspace_member(db, workspace_id, user.uid)


async def require_workspace_owner(
    db: AsyncSession, workspace_id: uuid.UUID | str, user: AuthUser
):
    """Return membership only if the current user owns the workspace."""
    return await _require_workspace_owner(db, workspace_id, user.uid)
