from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.shares import _resolve_user_by_email
from app.core.auth import AuthUser, get_current_user
from app.core.database import get_db
from app.core.permissions import ensure_user_exists
from app.models.user import User
from app.models.pending_invitation import WorkspaceInvitation
from app.models.workspace import (
    Workspace,
    WorkspaceMembership,
    WorkspaceRole,
    WorkspaceType,
)
from app.models.workspace_knowledge import WorkspaceKnowledgeBank
from app.schemas.workspace import (
    WorkspaceCreate,
    WorkspaceDetailResponse,
    WorkspaceKnowledgeBankCreate,
    WorkspaceKnowledgeBankResponse,
    WorkspaceKnowledgeBankUpdate,
    WorkspaceMemberAdd,
    WorkspaceMemberResponse,
    WorkspaceResponse,
    WorkspaceUpdate,
)
from app.services.pending_invitations import (
    delete_workspace_invitations_for_email,
    normalize_invite_email,
    serialize_workspace_invitation,
)
from app.services.workspaces import (
    ensure_personal_workspace,
    require_workspace_member,
    require_workspace_owner,
    serialize_member,
    serialize_workspace,
)
from app.services.workspace_knowledge import WorkspaceKnowledgeService
from app.core.database import AsyncSessionLocal

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
    member_rows = [
        serialize_member(membership, member_user) for membership, member_user in rows
    ]
    inv_rows = (
        (
            await db.execute(
                select(WorkspaceInvitation)
                .where(WorkspaceInvitation.workspace_id == workspace.id)
                .order_by(WorkspaceInvitation.created_at)
            )
        )
        .scalars()
        .all()
    )
    pending_rows = [serialize_workspace_invitation(inv) for inv in inv_rows]
    combined = member_rows + pending_rows
    combined.sort(key=lambda row: row["created_at"])
    data["members"] = combined
    return data


def _serialize_knowledge_bank(bank: WorkspaceKnowledgeBank) -> dict:
    return {
        "id": bank.id,
        "workspace_id": bank.workspace_id,
        "name": bank.name,
        "base_url": bank.base_url,
        "is_active": bank.is_active,
        "status": bank.status,
        "last_indexed_at": bank.last_indexed_at,
        "index_error": bank.index_error,
        "created_at": bank.created_at,
        "updated_at": bank.updated_at,
    }


async def _index_workspace_knowledge_bank_task(bank_id: UUID, user_id: str) -> None:
    """Background job to index a workspace knowledge bank without blocking request latency."""
    async with AsyncSessionLocal() as db:
        bank = await db.get(WorkspaceKnowledgeBank, bank_id)
        if bank is None:
            return
        service = WorkspaceKnowledgeService(db, user_id=user_id)
        try:
            await service.index_knowledge_bank(bank)
            await db.commit()
        except Exception:
            await db.commit()


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
    return [
        serialize_workspace(workspace, membership) for workspace, membership in rows
    ]


@router.post(
    "/workspaces",
    response_model=WorkspaceDetailResponse,
    status_code=status.HTTP_201_CREATED,
)
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found"
        )
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found"
        )

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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found"
        )
    if workspace.workspace_type == WorkspaceType.PERSONAL.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Personal workspaces cannot have additional members",
        )

    invite_email = normalize_invite_email(data.email)
    if user.email and invite_email == normalize_invite_email(user.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot add yourself as a workspace member.",
        )

    target_user = await _resolve_user_by_email(db, invite_email)
    if target_user:
        await delete_workspace_invitations_for_email(db, workspace_id, invite_email)
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
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="User is already a member"
            )

        membership = WorkspaceMembership(
            workspace_id=workspace_id,
            user_id=target_user.id,
            role=WorkspaceRole.MEMBER.value,
        )
        db.add(membership)
        await db.commit()
        await db.refresh(membership)
        return serialize_member(membership, target_user)

    pending_existing = (
        await db.execute(
            select(WorkspaceInvitation).where(
                WorkspaceInvitation.workspace_id == workspace_id,
                WorkspaceInvitation.email == invite_email,
            )
        )
    ).scalar_one_or_none()
    if pending_existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An invitation for this email is already pending for this workspace.",
        )

    invitation = WorkspaceInvitation(
        workspace_id=workspace_id,
        email=invite_email,
        role=WorkspaceRole.MEMBER.value,
        invited_by=user.uid,
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)
    return serialize_workspace_invitation(invitation)


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
    if membership is not None and membership.workspace_id == workspace_id:
        pass  # handle below
    else:
        invitation = await db.get(WorkspaceInvitation, membership_id)
        if invitation is None or invitation.workspace_id != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Member not found"
            )
        is_owner = current.role == WorkspaceRole.OWNER.value
        if not is_owner:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only workspace owners can remove pending invitations",
            )
        await db.delete(invitation)
        await db.commit()
        return {"success": True}

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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found"
        )
    if workspace.workspace_type == WorkspaceType.PERSONAL.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Personal workspaces cannot be deleted",
        )

    await db.delete(workspace)
    await db.commit()


@router.get(
    "/workspaces/{workspace_id}/knowledge-banks",
    response_model=list[WorkspaceKnowledgeBankResponse],
)
async def list_workspace_knowledge_banks(
    workspace_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """List workspace knowledge banks."""
    await ensure_user_exists(db, user)
    await require_workspace_member(db, workspace_id, user.uid)
    service = WorkspaceKnowledgeService(db, user_id=user.uid)
    banks = await service.list_workspace_banks(workspace_id)
    return [_serialize_knowledge_bank(bank) for bank in banks]


@router.post(
    "/workspaces/{workspace_id}/knowledge-banks",
    response_model=WorkspaceKnowledgeBankResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_workspace_knowledge_bank(
    workspace_id: UUID,
    data: WorkspaceKnowledgeBankCreate,
    background_tasks: BackgroundTasks,
    index_now: bool = True,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Create and optionally index a workspace knowledge bank."""
    await ensure_user_exists(db, user)
    await require_workspace_owner(db, workspace_id, user.uid)

    bank = WorkspaceKnowledgeBank(
        workspace_id=workspace_id,
        name=data.name.strip(),
        base_url=data.base_url.strip(),
    )
    db.add(bank)
    await db.flush()

    if index_now:
        background_tasks.add_task(
            _index_workspace_knowledge_bank_task, bank.id, user.uid
        )

    await db.commit()
    await db.refresh(bank)
    return _serialize_knowledge_bank(bank)


@router.patch(
    "/workspaces/{workspace_id}/knowledge-banks/{bank_id}",
    response_model=WorkspaceKnowledgeBankResponse,
)
async def update_workspace_knowledge_bank(
    workspace_id: UUID,
    bank_id: UUID,
    data: WorkspaceKnowledgeBankUpdate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Update workspace knowledge bank metadata."""
    await ensure_user_exists(db, user)
    await require_workspace_owner(db, workspace_id, user.uid)
    bank = await db.get(WorkspaceKnowledgeBank, bank_id)
    if bank is None or bank.workspace_id != workspace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge bank not found"
        )

    url_changed = False
    if data.name is not None:
        bank.name = data.name.strip()
    if data.base_url is not None:
        new_url = data.base_url.strip()
        if new_url != bank.base_url:
            bank.base_url = new_url
            url_changed = True
    if data.is_active is not None:
        bank.is_active = data.is_active
    await db.commit()
    await db.refresh(bank)
    if url_changed:
        background_tasks.add_task(
            _index_workspace_knowledge_bank_task, bank.id, user.uid
        )
    return _serialize_knowledge_bank(bank)


@router.post(
    "/workspaces/{workspace_id}/knowledge-banks/{bank_id}/reindex",
    response_model=WorkspaceKnowledgeBankResponse,
)
async def reindex_workspace_knowledge_bank(
    workspace_id: UUID,
    bank_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Rebuild the embedded index for a workspace knowledge bank."""
    await ensure_user_exists(db, user)
    await require_workspace_owner(db, workspace_id, user.uid)
    bank = await db.get(WorkspaceKnowledgeBank, bank_id)
    if bank is None or bank.workspace_id != workspace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge bank not found"
        )

    service = WorkspaceKnowledgeService(db, user_id=user.uid)
    try:
        await service.index_knowledge_bank(bank)
    except Exception as exc:
        await db.commit()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))

    await db.commit()
    await db.refresh(bank)
    return _serialize_knowledge_bank(bank)


@router.delete(
    "/workspaces/{workspace_id}/knowledge-banks/{bank_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_workspace_knowledge_bank(
    workspace_id: UUID,
    bank_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Delete a workspace knowledge bank and its indexed chunks."""
    await ensure_user_exists(db, user)
    await require_workspace_owner(db, workspace_id, user.uid)
    bank = await db.get(WorkspaceKnowledgeBank, bank_id)
    if bank is None or bank.workspace_id != workspace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge bank not found"
        )

    await db.delete(bank)
    await db.commit()
