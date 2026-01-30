from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from app.core.database import get_db
from app.core.auth import get_current_user, MockUser
from app.models.initiative import Initiative
from app.models.chat import ChatMessage
from app.schemas.initiative import (
    InitiativeCreate,
    InitiativeResponse,
    InitiativeConfirmResponse,
)

router = APIRouter()


@router.post("/initiatives", response_model=InitiativeResponse, status_code=status.HTTP_201_CREATED)
async def create_initiative(
    data: InitiativeCreate,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Create a new initiative and start the intake process"""
    initiative = Initiative(
        user_id=user.uid,
        title=data.title,
    )
    db.add(initiative)
    await db.commit()
    await db.refresh(initiative)
    
    # Add initial assistant message
    initial_message = ChatMessage(
        initiative_id=initiative.id,
        role="assistant",
        content="Briefly describe your project.",
    )
    db.add(initial_message)
    await db.commit()
    
    return initiative


@router.get("/initiatives/{initiative_id}", response_model=InitiativeResponse)
async def get_initiative(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Get an initiative by ID"""
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
    
    return initiative


@router.post("/initiatives/{initiative_id}/confirm", response_model=InitiativeConfirmResponse)
async def confirm_initiative(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Confirm the intake stage and move to evidence stage"""
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
    
    if not initiative.is_intake_complete():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot confirm: required fields are not complete",
        )
    
    # Update stage
    initiative.stage_1_complete = True
    initiative.stage = "evidence"
    await db.commit()
    
    # Add confirmation message
    confirm_message = ChatMessage(
        initiative_id=initiative.id,
        role="assistant",
        content="Great! Your initiative is confirmed. Now let's add some supporting evidence. You can upload a document or paste text.",
        widget_type="evidence_input",
        widget_data={"status": "ready"},
    )
    db.add(confirm_message)
    await db.commit()
    
    return InitiativeConfirmResponse(
        success=True,
        stage="evidence",
        message="Initiative confirmed. Ready for evidence upload.",
    )


@router.get("/initiatives", response_model=list[InitiativeResponse])
async def list_initiatives(
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
    limit: int = 20,
    offset: int = 0,
):
    """List all initiatives for the current user"""
    result = await db.execute(
        select(Initiative)
        .where(Initiative.user_id == user.uid)
        .order_by(Initiative.updated_at.desc())
        .limit(limit)
        .offset(offset)
    )
    initiatives = result.scalars().all()
    return initiatives


@router.patch("/initiatives/{initiative_id}", response_model=InitiativeResponse)
async def update_initiative(
    initiative_id: UUID,
    data: InitiativeCreate,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Update an initiative (title, etc.)"""
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
    
    if data.title is not None:
        initiative.title = data.title
    
    await db.commit()
    await db.refresh(initiative)
    
    return initiative


@router.delete("/initiatives/{initiative_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_initiative(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Delete an initiative and all related data"""
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
    
    await db.delete(initiative)
    await db.commit()
    
    return None
