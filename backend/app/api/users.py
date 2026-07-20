import logging
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.database import get_db
from app.core.auth import AuthUser, get_current_user, _init_firebase
from app.core.permissions import ensure_user_exists
from app.core.storage import get_storage
from app.models.chat import CoreChat
from app.models.memo import MemoVersion
from app.models.project import Project
from app.models.project_share import ProjectShare
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMembership, WorkspaceRole, WorkspaceType
from app.schemas.share import UserSearchResult
from app.core.rate_limit import limiter
from app.services.billing import cancel_active_subscription

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/users/search", response_model=list[UserSearchResult])
@limiter.limit("30/minute")
async def search_users(
    request: Request,
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Search users by email prefix, scoped to past collaborators.

    Only returns users who share at least one project with the caller.
    For users not yet collaborating, the caller must provide an exact email.
    """
    await ensure_user_exists(db, user)

    my_projects = (
        select(ProjectShare.project_id)
        .where(ProjectShare.user_id == user.uid)
    )
    collaborator_ids = (
        select(ProjectShare.user_id)
        .where(
            ProjectShare.project_id.in_(my_projects),
            ProjectShare.user_id != user.uid,
        )
    )

    result = await db.execute(
        select(User)
        .where(
            User.email.ilike(f"{q}%"),
            User.id != user.uid,
            User.id.in_(collaborator_ids),
        )
        .limit(10)
    )
    collaborators = result.scalars().all()
    return collaborators


async def _account_deletion_blockers(db: AsyncSession, user_id: str) -> list[str]:
    """Human-readable reasons the account can't be deleted yet.

    Deleting a user is only safe to cascade automatically when nobody else
    depends on the resources they solely own. If they're the sole owner of a
    team workspace with other members, or of a project with collaborators,
    we block deletion rather than silently cutting other users off from
    shared data — there's no ownership-transfer flow to fall back on yet.
    """
    blockers: list[str] = []

    owned_team_workspaces = (
        await db.execute(
            select(Workspace)
            .join(WorkspaceMembership, WorkspaceMembership.workspace_id == Workspace.id)
            .where(
                WorkspaceMembership.user_id == user_id,
                WorkspaceMembership.role == WorkspaceRole.OWNER.value,
                Workspace.workspace_type == WorkspaceType.TEAM.value,
            )
        )
    ).scalars().all()
    for workspace in owned_team_workspaces:
        other_members = await db.scalar(
            select(func.count())
            .select_from(WorkspaceMembership)
            .where(
                WorkspaceMembership.workspace_id == workspace.id,
                WorkspaceMembership.user_id != user_id,
            )
        )
        if other_members:
            noun = "member" if other_members == 1 else "members"
            blockers.append(f'workspace "{workspace.name}" ({other_members} other {noun})')

    shared_project_rows = (
        await db.execute(
            select(Project.name, func.count(ProjectShare.id))
            .join(ProjectShare, ProjectShare.project_id == Project.id)
            .where(Project.created_by == user_id, ProjectShare.user_id != user_id)
            .group_by(Project.id, Project.name)
        )
    ).all()
    for name, count in shared_project_rows:
        noun = "collaborator" if count == 1 else "collaborators"
        blockers.append(f'project "{name}" ({count} {noun})')

    return blockers


@router.delete("/users/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_account(
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Permanently delete the current user's account and everything they solely own.

    Deletes: projects they created with no other collaborators (and all
    child data — evidence, memos, assessments, materials), their personal
    workspace, personal chat history, workspace memberships / project shares
    on other people's resources, Google Drive connections, API keys, and
    billing records. Cancels any active Stripe subscription first. Removes
    the Firebase Auth identity last so a mid-failure never leaves someone
    locked out with half-deleted data — worst case they can sign back in.

    Blocked (409) if they're the sole owner of team resources other people
    still depend on; see ``_account_deletion_blockers``.
    """
    await ensure_user_exists(db, user)

    blockers = await _account_deletion_blockers(db, user.uid)
    if blockers:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Can't delete your account while you're the sole owner of shared "
                f"resources: {'; '.join(blockers)}. Remove the other members/"
                "collaborators or delete those first, then try again."
            ),
        )

    # Projects this user created, anywhere (personal or team workspace).
    # Safe to delete outright — the blocker check above guarantees none of
    # them have other collaborators, so nobody else can reach them.
    own_projects = (
        await db.execute(select(Project).where(Project.created_by == user.uid))
    ).scalars().all()

    export_paths: list[str] = []
    project_ids: list[str] = []
    for project in own_projects:
        project_ids.append(str(project.id))
        memo_result = await db.execute(
            select(MemoVersion.export_path).where(
                MemoVersion.project_id == project.id,
                MemoVersion.export_path.isnot(None),
            )
        )
        export_paths.extend(p for p in memo_result.scalars().all() if p)
        await db.delete(project)

    # Team workspaces they own — the blocker check above guarantees none had
    # other members at that point, but re-check per-workspace here in case a
    # membership change slipped in between; skip (don't delete) if so rather
    # than risk destroying a workspace someone just joined.
    owned_team_workspaces = (
        await db.execute(
            select(Workspace)
            .join(WorkspaceMembership, WorkspaceMembership.workspace_id == Workspace.id)
            .where(
                WorkspaceMembership.user_id == user.uid,
                WorkspaceMembership.role == WorkspaceRole.OWNER.value,
                Workspace.workspace_type == WorkspaceType.TEAM.value,
            )
        )
    ).scalars().all()
    for workspace in owned_team_workspaces:
        other_members = await db.scalar(
            select(func.count())
            .select_from(WorkspaceMembership)
            .where(
                WorkspaceMembership.workspace_id == workspace.id,
                WorkspaceMembership.user_id != user.uid,
            )
        )
        if not other_members:
            await db.delete(workspace)

    # Personal (non-project) chat history — core_chats has no DB-level FK to
    # users, so it would otherwise survive account deletion untouched.
    own_chats = (
        await db.execute(select(CoreChat).where(CoreChat.user_id == user.uid))
    ).scalars().all()
    for chat in own_chats:
        await db.delete(chat)

    # Stop billing before the Subscription row is cascade-deleted below.
    await cancel_active_subscription(user.uid, db)

    db_user = await db.get(User, user.uid)
    if db_user is not None:
        await db.delete(db_user)
    await db.commit()

    # Best-effort storage cleanup — DB rows are already gone either way.
    settings = get_settings()
    for project_id in project_ids:
        try:
            uploads_dir = Path(settings.uploads_dir) / project_id
            if uploads_dir.exists():
                shutil.rmtree(uploads_dir, ignore_errors=True)
        except Exception:
            logger.warning(
                "Failed to clean up uploads for deleted project %s", project_id, exc_info=True
            )
    if export_paths:
        try:
            exports_storage = get_storage()
            for path in export_paths:
                await exports_storage.delete(path)
        except Exception:
            logger.warning(
                "Failed to clean up exports for deleted user %s", user.uid, exc_info=True
            )

    if _init_firebase():
        try:
            from firebase_admin import auth as fb_auth

            fb_auth.delete_user(user.uid)
        except Exception:
            logger.warning(
                "Failed to delete Firebase auth user %s", user.uid, exc_info=True
            )

    return None
