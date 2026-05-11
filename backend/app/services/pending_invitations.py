"""Pre-signup invitations for workspace membership and project shares."""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pending_invitation import ProjectShareInvitation, WorkspaceInvitation
from app.models.project_share import ProjectShare
from app.models.workspace import WorkspaceMembership, WorkspaceRole

logger = logging.getLogger(__name__)


def normalize_invite_email(email: str) -> str:
    return email.strip().lower()


def serialize_workspace_invitation(inv: WorkspaceInvitation) -> dict:
    return {
        "id": inv.id,
        "workspace_id": inv.workspace_id,
        "user_id": None,
        "user_email": inv.email,
        "user_display_name": None,
        "role": inv.role,
        "created_at": inv.created_at,
        "pending": True,
    }


async def redeem_pending_invitations(
    db: AsyncSession, user_id: str, email: str | None
) -> None:
    """Create memberships and shares for any invitations matching this user's email."""
    if not email:
        return
    norm = normalize_invite_email(email)
    if not norm:
        return

    ws_invites = (
        (
            await db.execute(
                select(WorkspaceInvitation).where(WorkspaceInvitation.email == norm)
            )
        )
        .scalars()
        .all()
    )
    for inv in ws_invites:
        existing = (
            await db.execute(
                select(WorkspaceMembership).where(
                    WorkspaceMembership.workspace_id == inv.workspace_id,
                    WorkspaceMembership.user_id == user_id,
                )
            )
        ).scalar_one_or_none()
        if not existing:
            db.add(
                WorkspaceMembership(
                    workspace_id=inv.workspace_id,
                    user_id=user_id,
                    role=inv.role
                    if inv.role
                    in (WorkspaceRole.OWNER.value, WorkspaceRole.MEMBER.value)
                    else WorkspaceRole.MEMBER.value,
                )
            )
        await db.delete(inv)
    if ws_invites:
        logger.info(
            "Redeemed %d workspace invitation(s) for user %s", len(ws_invites), user_id
        )

    share_invites = (
        (
            await db.execute(
                select(ProjectShareInvitation).where(
                    ProjectShareInvitation.email == norm
                )
            )
        )
        .scalars()
        .all()
    )
    for inv in share_invites:
        existing_share = (
            await db.execute(
                select(ProjectShare).where(
                    ProjectShare.initiative_id == inv.initiative_id,
                    ProjectShare.user_id == user_id,
                )
            )
        ).scalar_one_or_none()
        if not existing_share:
            db.add(
                ProjectShare(
                    initiative_id=inv.initiative_id,
                    user_id=user_id,
                    role=inv.role,
                    shared_by=inv.shared_by,
                )
            )
        await db.delete(inv)
    if share_invites:
        logger.info(
            "Redeemed %d project share invitation(s) for user %s",
            len(share_invites),
            user_id,
        )


def serialize_project_share_invitation(inv: ProjectShareInvitation) -> dict:
    return {
        "id": inv.id,
        "initiative_id": inv.initiative_id,
        "user_id": None,
        "user_email": inv.email,
        "user_display_name": None,
        "role": inv.role,
        "created_at": inv.created_at,
        "pending": True,
    }


async def delete_workspace_invitations_for_email(
    db: AsyncSession,
    workspace_id: UUID,
    email: str,
) -> None:
    norm = normalize_invite_email(email)
    await db.execute(
        delete(WorkspaceInvitation).where(
            WorkspaceInvitation.workspace_id == workspace_id,
            WorkspaceInvitation.email == norm,
        )
    )


async def delete_project_share_invitations_for_email(
    db: AsyncSession,
    initiative_id: UUID,
    email: str,
) -> None:
    norm = normalize_invite_email(email)
    await db.execute(
        delete(ProjectShareInvitation).where(
            ProjectShareInvitation.initiative_id == initiative_id,
            ProjectShareInvitation.email == norm,
        )
    )
