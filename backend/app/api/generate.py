from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from app.core.database import get_db
from app.core.auth import get_current_user, MockUser
from app.models.initiative import Initiative
from app.models.memo import MemoVersion
from app.models.chat import ChatMessage
from app.schemas.memo import MemoGenerateRequest, MemoResponse, MemoContent
from app.services.memo_generator import MemoGeneratorService

router = APIRouter()


@router.post("/initiatives/{initiative_id}/generate", response_model=MemoResponse)
async def generate_memo(
    initiative_id: UUID,
    data: MemoGenerateRequest,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Generate an investment memo using RAG"""
    # Get initiative
    result = await db.execute(
        select(Initiative).where(
            Initiative.id == initiative_id,
            Initiative.user_id == user.uid,
        )
    )
    initiative = result.scalar_one_or_none()
    
    if not initiative:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Initiative not found",
        )
    
    if not initiative.evidence_ready:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot generate: no evidence uploaded",
        )
    
    # Generate memo
    generator = MemoGeneratorService(db)
    memo_content, citations = await generator.generate(
        initiative=initiative,
        include_corpus=data.include_corpus,
    )
    
    # Save memo version
    memo_version = MemoVersion(
        initiative_id=initiative.id,
        content=memo_content.model_dump(mode="json"),
    )
    db.add(memo_version)
    await db.commit()
    await db.refresh(memo_version)
    
    # Save citations
    for citation in citations:
        citation.memo_version_id = memo_version.id
        db.add(citation)
    await db.commit()
    
    # Update initiative stage
    initiative.stage = "complete"
    await db.commit()
    
    # Add memo viewer message
    memo_message = ChatMessage(
        initiative_id=initiative.id,
        role="assistant",
        content="Here's your investment memo based on the evidence provided.",
        widget_type="memo_viewer",
        widget_data={
            "memo_id": str(memo_version.id),
            "content": memo_content.model_dump(mode="json"),
        },
    )
    db.add(memo_message)
    await db.commit()
    
    return MemoResponse(
        id=memo_version.id,
        initiative_id=initiative.id,
        content=memo_content,
        created_at=memo_version.created_at,
    )


@router.get("/initiatives/{initiative_id}/memo", response_model=MemoResponse)
async def get_latest_memo(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Get the latest memo for an initiative"""
    # Verify access
    result = await db.execute(
        select(Initiative).where(
            Initiative.id == initiative_id,
            Initiative.user_id == user.uid,
        )
    )
    initiative = result.scalar_one_or_none()
    
    if not initiative:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Initiative not found",
        )
    
    # Get latest memo
    memo_result = await db.execute(
        select(MemoVersion)
        .where(MemoVersion.initiative_id == initiative_id)
        .order_by(MemoVersion.created_at.desc())
        .limit(1)
    )
    memo = memo_result.scalar_one_or_none()
    
    if not memo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No memo found for this initiative",
        )
    
    return MemoResponse(
        id=memo.id,
        initiative_id=initiative.id,
        content=MemoContent(**memo.content),
        created_at=memo.created_at,
    )
