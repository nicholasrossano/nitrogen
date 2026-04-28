from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.shares import _resolve_user_by_email
from app.core.auth import AuthUser, get_current_user
from app.core.database import get_db
from app.core.permissions import ensure_user_exists
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMembership, WorkspaceRole, WorkspaceType
from app.schemas.workspace import (
    WorkspaceCreate,
    WorkspaceDetailResponse,
    WorkspaceMemberAdd,
    WorkspaceMemberResponse,
    WorkspaceResponse,
    WorkspaceUpdate,
)
from app.services.workspaces import (
    ensure_personal_workspace,
    require_workspace_member,
    require_workspace_owner,
    serialize_member,
    serialize_workspace,
)

router = APIRouter()


async def _workspace_detail(
    db: AsyncSession,
    workspace: Workspace,
    current_membership: WorkspaceMembership,
) -> dict:
    rows = (
        await db.execute(
            select(WorkspaceMembership, User)
            .outerjoin(User, User.id == WorkspaceMembership.user_id)
            .where(WorkspaceMembership.workspace_id == workspace.id)
            .order_by(WorkspaceMembership.created_at)
        )
    ).all()
    data = serialize_workspace(workspace, current_membership)
    data["members"] = [serialize_member(membership, member_user) for membership, member_user in rows]
    return data


@router.get("/workspaces", response_model=list[WorkspaceResponse])
async def list_workspaces(
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List workspaces the current user belongs to."""
    await ensure_user_exists(db, user)
    await ensure_personal_workspace(db, user.uid)
    await db.commit()

    rows = (
        await db.execute(
            select(Workspace, WorkspaceMembership)
            .join(WorkspaceMembership, WorkspaceMembership.workspace_id == Workspace.id)
            .where(WorkspaceMembership.user_id == user.uid)
            .order_by(Workspace.workspace_type.asc(), Workspace.created_at.asc())
        )
    ).all()
    return [serialize_workspace(workspace, membership) for workspace, membership in rows]


@router.post("/workspaces", response_model=WorkspaceDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_workspace(
    data: WorkspaceCreate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Create a team workspace owned by the current user."""
    await ensure_user_exists(db, user)
    workspace = Workspace(
        name=data.name.strip(),
        description=data.description,
        workspace_type=WorkspaceType.TEAM.value,
    )
    db.add(workspace)
    await db.flush()
    membership = WorkspaceMembership(
        workspace_id=workspace.id,
        user_id=user.uid,
        role=WorkspaceRole.OWNER.value,
    )
    db.add(membership)
    await db.commit()
    await db.refresh(workspace)
    await db.refresh(membership)
    return await _workspace_detail(db, workspace, membership)


@router.get("/workspaces/{workspace_id}", response_model=WorkspaceDetailResponse)
async def get_workspace(
    workspace_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Get workspace metadata and members."""
    await ensure_user_exists(db, user)
    membership = await require_workspace_member(db, workspace_id, user.uid)
    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    return await _workspace_detail(db, workspace, membership)


@router.patch("/workspaces/{workspace_id}", response_model=WorkspaceDetailResponse)
async def update_workspace(
    workspace_id: UUID,
    data: WorkspaceUpdate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Update workspace metadata. Owners only."""
    await ensure_user_exists(db, user)
    membership = await require_workspace_owner(db, workspace_id, user.uid)
    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")

    if data.name is not None:
        workspace.name = data.name.strip()
    if data.icon is not None:
        workspace.icon = data.icon.strip()
    if data.description is not None:
        workspace.description = data.description
    await db.commit()
    await db.refresh(workspace)
    return await _workspace_detail(db, workspace, membership)


@router.post(
    "/workspaces/{workspace_id}/members",
    response_model=WorkspaceMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_workspace_member(
    workspace_id: UUID,
    data: WorkspaceMemberAdd,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Add a user to a workspace. Owners only."""
    await ensure_user_exists(db, user)
    await require_workspace_owner(db, workspace_id, user.uid)

    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    if workspace.workspace_type == WorkspaceType.PERSONAL.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Personal workspaces cannot have additional members",
        )

    target_user = await _resolve_user_by_email(db, data.email.strip().lower())
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No Nitrogen account found for {data.email}. Ask them to sign in first, then try again.",
        )
    await ensure_personal_workspace(db, target_user.id)

    existing = (
        await db.execute(
            select(WorkspaceMembership).where(
                WorkspaceMembership.workspace_id == workspace_id,
                WorkspaceMembership.user_id == target_user.id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is already a member")

    membership = WorkspaceMembership(
        workspace_id=workspace_id,
        user_id=target_user.id,
        role=WorkspaceRole.MEMBER.value,
    )
    db.add(membership)
    await db.commit()
    await db.refresh(membership)
    return serialize_member(membership, target_user)


@router.delete("/workspaces/{workspace_id}/members/{membership_id}")
async def remove_workspace_member(
    workspace_id: UUID,
    membership_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Remove a member from a workspace. Owners only, except members may remove themselves."""
    await ensure_user_exists(db, user)
    current = await require_workspace_member(db, workspace_id, user.uid)
    membership = await db.get(WorkspaceMembership, membership_id)
    if membership is None or membership.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    is_self = membership.user_id == user.uid
    is_owner = current.role == WorkspaceRole.OWNER.value
    if not is_owner and not is_self:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only workspace owners can remove other members",
        )
    if membership.role == WorkspaceRole.OWNER.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Workspace owners cannot be removed in the MVP",
        )

    await db.delete(membership)
    await db.commit()
    return {"success": True}


@router.delete("/workspaces/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(
    workspace_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Delete a team workspace. Owners only."""
    await ensure_user_exists(db, user)
    await require_workspace_owner(db, workspace_id, user.uid)

    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    if workspace.workspace_type == WorkspaceType.PERSONAL.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Personal workspaces cannot be deleted",
        )

    await db.delete(workspace)
    await db.commit()
