from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from app.core.database import get_db
from app.core.auth import get_current_user, MockUser
from app.models.initiative import Initiative
from app.models.chat import ChatMessage
from app.schemas.chat import (
    ChatMessageCreate,
    ChatMessageResponse,
    ChatResponse,
    ChatHistoryResponse,
    StageStatus,
    ExtractedFields,
)
from app.services.chat_agent import ChatAgentService
from app.services.field_extractor import FieldExtractorService

router = APIRouter()


def get_missing_fields(initiative: Initiative) -> list[str]:
    """Get list of missing required fields"""
    missing = []
    if not initiative.title:
        missing.append("title")
    if not initiative.geography:
        missing.append("geography")
    if not initiative.target_population:
        missing.append("target_population")
    if not initiative.goal:
        missing.append("goal")
    return missing


def build_stage_status(initiative: Initiative) -> StageStatus:
    """Build stage status from initiative"""
    missing = get_missing_fields(initiative)
    return StageStatus(
        stage=initiative.stage,
        stage_1_complete=initiative.stage_1_complete,
        evidence_ready=initiative.evidence_ready,
        required_fields_complete=len(missing) == 0,
        missing_fields=missing,
    )


@router.post("/initiatives/{initiative_id}/chat", response_model=ChatResponse)
async def send_chat_message(
    initiative_id: UUID,
    data: ChatMessageCreate,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Send a chat message and get assistant response"""
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
    
    # Save user message
    user_message = ChatMessage(
        initiative_id=initiative.id,
        role="user",
        content=data.content,
    )
    db.add(user_message)
    await db.commit()
    
    # Get chat history
    history_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.initiative_id == initiative_id)
        .order_by(ChatMessage.created_at)
    )
    messages = history_result.scalars().all()
    
    # Process with chat agent
    chat_agent = ChatAgentService()
    field_extractor = FieldExtractorService()
    
    # Extract fields from conversation
    extracted = await field_extractor.extract_fields(messages)
    
    # Update initiative with extracted fields
    if extracted:
        if extracted.title and not initiative.title:
            initiative.title = extracted.title
        if extracted.sector:
            initiative.sector = extracted.sector
        if extracted.geography and not initiative.geography:
            initiative.geography = extracted.geography
        if extracted.target_population and not initiative.target_population:
            initiative.target_population = extracted.target_population
        if extracted.goal and not initiative.goal:
            initiative.goal = extracted.goal
        if extracted.budget_range:
            initiative.budget_range = extracted.budget_range
        if extracted.timeline:
            initiative.timeline = extracted.timeline
        if extracted.constraints:
            initiative.constraints = extracted.constraints
        await db.commit()
        await db.refresh(initiative)
    
    # Generate assistant response
    assistant_response = await chat_agent.generate_response(
        messages=messages,
        initiative=initiative,
    )
    
    # Check if we should show confirmation widget
    show_confirmation = (
        initiative.is_intake_complete() and 
        not initiative.stage_1_complete and
        initiative.stage == "intake"
    )
    
    # Build widget data if showing confirmation
    widget_type = None
    widget_data = None
    if show_confirmation:
        widget_type = "confirmation"
        widget_data = initiative.to_summary_dict()
    
    # Save assistant message
    assistant_message = ChatMessage(
        initiative_id=initiative.id,
        role="assistant",
        content=assistant_response,
        widget_type=widget_type,
        widget_data=widget_data,
    )
    db.add(assistant_message)
    await db.commit()
    await db.refresh(assistant_message)
    
    return ChatResponse(
        message=ChatMessageResponse(
            id=assistant_message.id,
            role=assistant_message.role,
            content=assistant_message.content,
            widget_type=assistant_message.widget_type,
            widget_data=assistant_message.widget_data,
            created_at=assistant_message.created_at,
        ),
        extracted_fields=extracted,
        stage_status=build_stage_status(initiative),
        show_confirmation=show_confirmation,
    )


@router.get("/initiatives/{initiative_id}/chat", response_model=ChatHistoryResponse)
async def get_chat_history(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Get chat history for an initiative"""
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
    
    # Get messages
    messages_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.initiative_id == initiative_id)
        .order_by(ChatMessage.created_at)
    )
    messages = messages_result.scalars().all()
    
    return ChatHistoryResponse(
        messages=[
            ChatMessageResponse(
                id=msg.id,
                role=msg.role,
                content=msg.content,
                widget_type=msg.widget_type,
                widget_data=msg.widget_data,
                created_at=msg.created_at,
            )
            for msg in messages
        ],
        stage_status=build_stage_status(initiative),
    )
