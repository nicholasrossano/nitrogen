from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMembership, WorkspaceRole, WorkspaceType

COMPANY_WORKSPACE_DEFAULT_NAME = "Company"


async def ensure_company_workspace(db: AsyncSession, user_id: str) -> Workspace:
    """Return the singleton company (team) workspace, ensuring the user is a member."""
    result = await db.execute(
        select(Workspace)
        .where(Workspace.workspace_type == WorkspaceType.TEAM.value)
        .order_by(Workspace.created_at)
        .limit(1)
    )
    workspace = result.scalar_one_or_none()
    if workspace is None:
        workspace = Workspace(
            name=COMPANY_WORKSPACE_DEFAULT_NAME,
            workspace_type=WorkspaceType.TEAM.value,
        )
        db.add(workspace)
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            result = await db.execute(
                select(Workspace)
                .where(Workspace.workspace_type == WorkspaceType.TEAM.value)
                .order_by(Workspace.created_at)
                .limit(1)
            )
            workspace = result.scalar_one()

    membership = await get_workspace_membership(db, workspace.id, user_id)
    if membership is None:
        owner_count = await db.scalar(
            select(func.count())
            .select_from(WorkspaceMembership)
            .where(
                WorkspaceMembership.workspace_id == workspace.id,
                WorkspaceMembership.role == WorkspaceRole.OWNER.value,
            )
        )
        role = WorkspaceRole.OWNER.value if not owner_count else WorkspaceRole.MEMBER.value
        db.add(
            WorkspaceMembership(
                workspace_id=workspace.id,
                user_id=user_id,
                role=role,
            )
        )
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()

    return workspace


async def ensure_personal_workspace(db: AsyncSession, user_id: str) -> Workspace:
    """Return the user's personal workspace, creating it and owner membership if needed."""
    result = await db.execute(
        select(Workspace).where(Workspace.personal_owner_id == user_id)
    )
    workspace = result.scalar_one_or_none()
    if workspace is None:
        workspace = Workspace(
            name="Personal",
            workspace_type=WorkspaceType.PERSONAL.value,
            personal_owner_id=user_id,
        )
        db.add(workspace)
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            result = await db.execute(
                select(Workspace).where(Workspace.personal_owner_id == user_id)
            )
            workspace = result.scalar_one()

    membership = await get_workspace_membership(db, workspace.id, user_id)
    if membership is None:
        db.add(
            WorkspaceMembership(
                workspace_id=workspace.id,
                user_id=user_id,
                role=WorkspaceRole.OWNER.value,
            )
        )
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()

    return workspace


async def get_workspace_membership(
    db: AsyncSession,
    workspace_id: UUID | str,
    user_id: str,
) -> WorkspaceMembership | None:
    """Return a user's workspace membership if it exists."""
    result = await db.execute(
        select(WorkspaceMembership).where(
            WorkspaceMembership.workspace_id == workspace_id,
            WorkspaceMembership.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def require_workspace_member(
    db: AsyncSession,
    workspace_id: UUID | str,
    user_id: str,
) -> WorkspaceMembership:
    """Require any workspace membership."""
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    return membership


async def require_workspace_owner(
    db: AsyncSession,
    workspace_id: UUID | str,
    user_id: str,
) -> WorkspaceMembership:
    """Require workspace owner membership for administration."""
    membership = await require_workspace_member(db, workspace_id, user_id)
    if membership.role != WorkspaceRole.OWNER.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only workspace owners can perform this action",
        )
    return membership


async def get_default_workspace_for_user(db: AsyncSession, user_id: str) -> Workspace:
    """Return the singleton company workspace for a user."""
    return await ensure_company_workspace(db, user_id)


async def resolve_workspace_for_user(
    db: AsyncSession,
    user_id: str,
    workspace_id: UUID | str | None,
) -> tuple[Workspace, WorkspaceMembership]:
    """Resolve an explicit workspace or the user's personal workspace."""
    if workspace_id is None:
        workspace = await get_default_workspace_for_user(db, user_id)
        membership = await get_workspace_membership(db, workspace.id, user_id)
        if membership is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
        return workspace, membership

    membership = await require_workspace_member(db, workspace_id, user_id)
    workspace = await db.get(Workspace, membership.workspace_id)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    return workspace, membership


def serialize_workspace(workspace: Workspace, membership: WorkspaceMembership) -> dict:
    """Serialize workspace with caller role."""
    return {
        "id": workspace.id,
        "name": workspace.name,
        "icon": workspace.icon,
        "description": workspace.description,
        "workspace_type": workspace.workspace_type,
        "current_user_role": membership.role,
        "created_at": workspace.created_at,
        "updated_at": workspace.updated_at,
    }


def serialize_member(membership: WorkspaceMembership, user: User | None) -> dict:
    """Serialize workspace membership with user metadata."""
    return {
        "id": membership.id,
        "workspace_id": membership.workspace_id,
        "user_id": membership.user_id,
        "user_email": user.email if user else None,
        "user_display_name": user.display_name if user else None,
        "role": membership.role,
        "created_at": membership.created_at,
        "pending": False,
    }
