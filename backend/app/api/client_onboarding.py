import logging
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.auth import AuthUser, get_current_user, get_optional_user
from app.core.permissions import ensure_user_exists, require_editor
from app.models.client_invitation import ClientInvitation
from app.models.initiative import Initiative
from app.models.project_share import ProjectShare
from app.models.user import User
from app.models.chat import ChatMessage

router = APIRouter()
logger = logging.getLogger(__name__)

INVITE_EXPIRY_DAYS = 30


class ClientInviteRequest(BaseModel):
    client_email: Optional[str] = None
    title: Optional[str] = None


class ClientInviteResponse(BaseModel):
    invitation_id: uuid.UUID
    token: str

    class Config:
        from_attributes = True


class InviteValidationResponse(BaseModel):
    invited_by_name: Optional[str] = None
    project_title: Optional[str] = None
    requires_auth: bool


class InviteAcceptResponse(BaseModel):
    initiative_id: uuid.UUID


@router.post(
    "/initiatives/{initiative_id}/client-invite",
    response_model=ClientInviteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_client_invite_for_existing(
    initiative_id: uuid.UUID,
    body: ClientInviteRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Create a client invitation link for an already-existing initiative. Owner or editor."""
    await ensure_user_exists(db, user)
    await require_editor(db, initiative_id, user)

    token = secrets.token_urlsafe(32)
    invitation = ClientInvitation(
        initiative_id=initiative_id,
        token=token,
        client_email=body.client_email,
        invited_by=user.uid,
        expires_at=datetime.now(timezone.utc) + timedelta(days=INVITE_EXPIRY_DAYS),
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)

    return ClientInviteResponse(invitation_id=invitation.id, token=token)


@router.post(
    "/client-onboard",
    response_model=ClientInviteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_invite_only(
    body: ClientInviteRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Create a client invitation without a project.
    The project is created when the client accepts the invite.
    """
    await ensure_user_exists(db, user)

    token = secrets.token_urlsafe(32)
    invitation = ClientInvitation(
        initiative_id=None,
        token=token,
        client_email=body.client_email,
        project_title=body.title or None,
        invited_by=user.uid,
        expires_at=datetime.now(timezone.utc) + timedelta(days=INVITE_EXPIRY_DAYS),
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)

    return ClientInviteResponse(invitation_id=invitation.id, token=token)


@router.get(
    "/invite/{token}",
    response_model=InviteValidationResponse,
)
async def validate_invite(
    token: str,
    db: AsyncSession = Depends(get_db),
    user: Optional[AuthUser] = Depends(get_optional_user),
):
    """Validate an invite token. Public (no auth required)."""
    invitation = await _get_valid_invitation(db, token)
    inviter = await db.get(User, invitation.invited_by)

    return InviteValidationResponse(
        invited_by_name=inviter.display_name or inviter.email if inviter else None,
        project_title=invitation.project_title,
        requires_auth=user is None,
    )


@router.post(
    "/invite/{token}/accept",
    response_model=InviteAcceptResponse,
)
async def accept_invite(
    token: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Accept an invite.
    If no project exists yet, one is created (owned by the consultant).
    The accepting user receives client-role access.
    """
    await ensure_user_exists(db, user)
    invitation = await _get_valid_invitation(db, token)

    # Resolve or create the initiative
    if invitation.initiative_id is not None:
        # Invitation was for an existing project
        initiative_id = invitation.initiative_id
        # Guard: client shouldn't be accepting their own project
        result = await db.execute(
            select(Initiative).where(Initiative.id == initiative_id)
        )
        initiative = result.scalar_one_or_none()
        if initiative and initiative.user_id == user.uid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You are the owner of this project.",
            )
    else:
        # Create the project now, owned by the consultant who sent the invite
        initiative = Initiative(
            user_id=invitation.invited_by,
            title=invitation.project_title,
        )
        db.add(initiative)
        await db.flush()  # get the ID without committing yet

        initial_message = ChatMessage(
            initiative_id=initiative.id,
            role="assistant",
            content="Briefly describe your project.",
        )
        db.add(initial_message)

        # Link the invitation to the newly created project
        invitation.initiative_id = initiative.id
        initiative_id = initiative.id

    # Grant client access (idempotent — skip if already shared)
    existing_share = (
        await db.execute(
            select(ProjectShare).where(
                ProjectShare.initiative_id == initiative_id,
                ProjectShare.user_id == user.uid,
            )
        )
    ).scalar_one_or_none()

    if not existing_share:
        share = ProjectShare(
            initiative_id=initiative_id,
            user_id=user.uid,
            role="client",
            shared_by=invitation.invited_by,
        )
        db.add(share)

    invitation.status = "accepted"
    invitation.accepted_by = user.uid
    await db.commit()

    return InviteAcceptResponse(initiative_id=initiative_id)


async def _get_valid_invitation(db: AsyncSession, token: str) -> ClientInvitation:
    """Look up an invitation by token and validate it."""
    result = await db.execute(
        select(ClientInvitation).where(ClientInvitation.token == token)
    )
    invitation = result.scalar_one_or_none()

    if not invitation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid invitation link.",
        )

    if invitation.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This invitation has already been used.",
        )

    if invitation.expires_at and invitation.expires_at < datetime.now(timezone.utc):
        invitation.status = "expired"
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This invitation has expired.",
        )

    return invitation
