import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser
from app.models.project import Initiative, Project
from app.models.project_share import ProjectShare
from app.models.user import User
from app.models.workspace import WorkspaceRole
from app.services.pending_invitations import redeem_pending_invitations
from app.services.workspaces import (
    ensure_company_workspace,
    get_workspace_membership,
    require_workspace_member as _require_workspace_member,
    require_workspace_owner as _require_workspace_owner,
)


_LAST_SEEN_THROTTLE_SECONDS = 300  # only update last_seen_at every 5 minutes


async def ensure_user_exists(db: AsyncSession, user: AuthUser) -> None:
    """Upsert the authenticated user into the users table."""
    if not user.uid or user.uid == "shared-user":
        return
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
        await ensure_company_workspace(db, user.uid)
        redeem_email = user.email or existing.email
        await redeem_pending_invitations(db, user.uid, redeem_email)
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
        await ensure_company_workspace(db, user.uid)
        await redeem_pending_invitations(db, user.uid, user.email)
        await db.commit()


async def _get_role_for_initiative(
    db: AsyncSession,
    initiative: Initiative,
    user: AuthUser,
) -> str | None:
    """Resolve the current user's role for a concrete initiative."""
    if initiative.workspace_id:
        membership = await get_workspace_membership(
            db, initiative.workspace_id, user.uid
        )
        if membership:
            if membership.role == WorkspaceRole.OWNER.value:
                return "owner"
            return "editor"

    if initiative.user_id == user.uid:
        return "owner"

    share_result = await db.execute(
        select(ProjectShare).where(
            ProjectShare.project_id == initiative.id,
            ProjectShare.user_id == user.uid,
        )
    )
    share = share_result.scalar_one_or_none()
    if share:
        return share.role

    return None


async def get_initiative_with_role(
    db: AsyncSession,
    initiative_id: uuid.UUID | str,
    user: AuthUser,
) -> tuple[Initiative, str]:
    """Return (initiative, role) where role is 'owner', 'editor', or 'viewer'.

    Accepts only canonical UUID initiative identifiers.
    Raises 404 if the user has no access.
    """
    try:
        uid = uuid.UUID(str(initiative_id))
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Initiative not found"
        )

    result = await db.execute(select(Initiative).where(Initiative.id == uid))
    initiative = result.scalar_one_or_none()
    if initiative is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Initiative not found"
        )

    role = await _get_role_for_initiative(db, initiative, user)
    if role:
        return initiative, role
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Initiative not found"
    )


async def get_project_with_role(
    db: AsyncSession,
    project_id: uuid.UUID | str,
    user: AuthUser,
) -> tuple[Project, str]:
    """Return (project, role) for a canonical project UUID."""
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

    role = await _get_role_for_initiative(db, project, user)
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
    project, role = await get_project_with_role(db, project_id, user)
    if role == "viewer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Viewers cannot modify this project",
        )
    return project


async def require_owner(
    db: AsyncSession,
    initiative_id: uuid.UUID | str,
    user: AuthUser,
) -> Initiative:
    """Return initiative if the user can manage project-level destructive actions."""
    initiative, role = await get_initiative_with_role(db, initiative_id, user)
    if role == "owner":
        return initiative
    if role == "editor" and initiative.workspace_id:
        membership = await get_workspace_membership(
            db, initiative.workspace_id, user.uid
        )
        if membership:
            return initiative
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN, detail="You cannot manage this project"
    )


async def require_editor(
    db: AsyncSession,
    initiative_id: uuid.UUID | str,
    user: AuthUser,
) -> Initiative:
    """Return initiative if the user is owner or editor, else 403."""
    initiative, role = await get_initiative_with_role(db, initiative_id, user)
    if role == "viewer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Viewers cannot modify this project",
        )
    return initiative


async def require_viewer(
    db: AsyncSession,
    initiative_id: uuid.UUID | str,
    user: AuthUser,
) -> Initiative:
    """Return initiative if the user has any access (owner/editor/viewer)."""
    initiative, _role = await get_initiative_with_role(db, initiative_id, user)
    return initiative


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
