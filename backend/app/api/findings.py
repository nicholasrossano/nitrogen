import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser, get_current_user
from app.core.database import get_db
from app.core.permissions import ensure_user_exists, get_project_with_role, require_project_editor
from app.models.chat import CoreChatMessage
from app.models.finding import Finding
from app.models.initiative import Initiative
from app.models.user import User
from app.schemas.finding import FindingPromoteRequest, FindingResponse
from app.services.assumptions import AssumptionActor, extract_assumptions_from_finding

logger = logging.getLogger(__name__)

router = APIRouter()


def _finding_response(finding: Finding, promoter_email: str | None = None) -> dict:
    data = FindingResponse.model_validate(finding).model_dump()
    data["promoter_email"] = promoter_email
    return data


@router.get("/projects/{project_id}/findings")
async def list_findings(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    await ensure_user_exists(db, user)
    await get_project_with_role(db, project_id, user)
    rows = (
        await db.execute(
            select(Finding)
            .where(Finding.project_id == project_id)
            .order_by(Finding.created_at.desc())
        )
    ).scalars().all()
    results = []
    for finding in rows:
        promoter = await db.get(User, finding.promoted_by)
        results.append(_finding_response(finding, promoter.email if promoter else None))
    return {"findings": results}


@router.post("/findings/promote", response_model=FindingResponse, status_code=status.HTTP_201_CREATED)
async def promote_finding(
    data: FindingPromoteRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Promote a personal chat message to a project finding; extract assumptions."""
    await ensure_user_exists(db, user)
    await require_project_editor(db, str(data.project_id), user)

    message = await db.get(CoreChatMessage, data.chat_message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Chat message not found")

    body = (data.body or message.content or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Finding body is empty")

    sources = message.sources if isinstance(message.sources, list) else None
    finding = Finding(
        project_id=data.project_id,
        body=body,
        sources=sources,
        promoted_by=user.uid,
        source_chat_message_id=message.id,
    )
    db.add(finding)
    await db.flush()

    initiative = await db.get(Initiative, data.project_id)
    if initiative is not None:
        try:
            await extract_assumptions_from_finding(
                db,
                initiative,
                finding_id=finding.id,
                body=body,
                sources=sources,
                chat_message_id=message.id,
                actor=AssumptionActor(user_id=user.uid, email=user.email),
            )
        except Exception:
            logger.exception("Assumption extraction on promote failed for finding %s", finding.id)

    await db.commit()
    await db.refresh(finding)
    return _finding_response(finding, user.email)


@router.get("/findings/{finding_id}", response_model=FindingResponse)
async def get_finding(
    finding_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    await ensure_user_exists(db, user)
    finding = await db.get(Finding, finding_id)
    if finding is None:
        raise HTTPException(status_code=404, detail="Finding not found")
    await get_project_with_role(db, finding.project_id, user)
    promoter = await db.get(User, finding.promoted_by)
    return _finding_response(finding, promoter.email if promoter else None)
