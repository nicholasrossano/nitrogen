"""Chat API endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from app.core.database import get_db
from app.core.auth import get_current_user, MockUser
from app.models.initiative import Initiative, InitiativeStage
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
from app.services.sdg_classifier import classify_sdg
from app.tools import get_tool_registry

router = APIRouter()


def build_stage_status(initiative: Initiative) -> StageStatus:
    """Build stage status from initiative."""
    # For new flow, check tool-based completion
    missing = []
    if initiative.stage in [InitiativeStage.GATHER_INPUTS.value, InitiativeStage.REVIEW.value]:
        missing_inputs = initiative.get_missing_tool_inputs()
        for tool_id, fields in missing_inputs.items():
            missing.extend(fields)
    else:
        # Legacy field checking
        if not initiative.title:
            missing.append("title")
        if not initiative.geography:
            missing.append("geography")
        if not initiative.target_population:
            missing.append("target_population")
        if not initiative.goal:
            missing.append("goal")
    
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
    """Send a chat message and get assistant response."""
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
    messages = list(history_result.scalars().all())
    
    # Process based on current stage
    chat_agent = ChatAgentService()
    widget_type = None
    widget_data = None
    extracted = None
    assistant_response = None  # Will be set by stage logic or generated
    
    if initiative.stage == InitiativeStage.DESCRIBE.value:
        # Extract project info from conversation
        project_info = await chat_agent.extract_project_info(messages)
        
        # Update initiative
        if project_info.get("project_description"):
            initiative.project_description = project_info["project_description"]
        if project_info.get("project_type"):
            initiative.project_type = project_info["project_type"]
        if project_info.get("title"):
            initiative.title = project_info["title"]
        if project_info.get("geography"):
            initiative.geography = project_info["geography"]
        if project_info.get("target_beneficiaries"):
            initiative.target_population = project_info["target_beneficiaries"]
        if project_info.get("project_goal"):
            initiative.goal = project_info["project_goal"]
        
        # Classify SDG
        sdg_info = classify_sdg(
            initiative.project_description or "",
            initiative.project_type,
        )
        if sdg_info:
            # Store SDG in tool_inputs for now
            tool_inputs = initiative.tool_inputs or {}
            tool_inputs["sdg"] = sdg_info
            initiative.tool_inputs = tool_inputs
        
        await db.commit()
        await db.refresh(initiative)
        
        # Check if we should show tool recommendations
        if initiative.has_project_description():
            widget_type = "tool_checklist"
            registry = get_tool_registry()
            recommendations = registry.recommend_tools(
                project_description=initiative.project_description,
                project_type=initiative.project_type,
            )
            widget_data = {
                "recommendations": [
                    {
                        "tool": tool.definition.to_dict(),
                        "confidence": confidence,
                        "recommended": confidence > 0.3,
                    }
                    for tool, confidence in recommendations
                ],
                "project_type": initiative.project_type,
            }
            # Move to tool selection stage
            initiative.stage = InitiativeStage.SELECT_TOOLS.value
            await db.commit()
            
    
    elif initiative.stage == InitiativeStage.GATHER_INPUTS.value:
        # Extract tool inputs from conversation
        if initiative.selected_tools:
            tool_inputs = await chat_agent.extract_tool_inputs(
                messages=messages,
                tool_ids=initiative.selected_tools,
            )
            
            # Merge with existing inputs
            current_inputs = initiative.tool_inputs or {}
            for key, value in tool_inputs.items():
                if value:  # Only update non-empty values
                    current_inputs[key] = value
            initiative.tool_inputs = current_inputs
            
            # Also update legacy fields
            if tool_inputs.get("project_title"):
                initiative.title = tool_inputs["project_title"]
            if tool_inputs.get("geography"):
                initiative.geography = tool_inputs["geography"]
            if tool_inputs.get("target_beneficiaries"):
                initiative.target_population = tool_inputs["target_beneficiaries"]
            if tool_inputs.get("project_goal"):
                initiative.goal = tool_inputs["project_goal"]
            
            await db.commit()
            await db.refresh(initiative)
        
        # Check if ready to show deliverables overview
        missing = initiative.get_missing_tool_inputs()
        if not missing:
            # Move to review stage
            initiative.stage = InitiativeStage.REVIEW.value
            await db.commit()
            
            widget_type = "deliverables_overview"
            registry = get_tool_registry()
            tools_info = []
            for tool_id in (initiative.selected_tools or []):
                tool = registry.get_tool(tool_id)
                if tool:
                    tools_info.append({
                        "id": tool.definition.id,
                        "name": tool.definition.name,
                        "description": tool.definition.description,
                        "icon": tool.definition.icon,
                        "output_type": tool.definition.output_type,
                    })
            widget_data = {
                "project_summary": initiative.to_summary_dict(),
                "selected_tools": tools_info,
                "tool_inputs": initiative.tool_inputs or {},
            }
    
    # Generate assistant response
    assistant_response = await chat_agent.generate_response(
        messages=messages,
        initiative=initiative,
        widget_type=widget_type,
    )
    
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
        show_confirmation=widget_type == "deliverables_overview",
    )


@router.get("/initiatives/{initiative_id}/chat", response_model=ChatHistoryResponse)
async def get_chat_history(
    initiative_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Get chat history for an initiative."""
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
    
    # If no messages, add initial greeting
    if not messages:
        greeting = ChatMessage(
            initiative_id=initiative_id,
            role="assistant",
            content="What are you working on?",
        )
        db.add(greeting)
        await db.commit()
        await db.refresh(greeting)
        messages = [greeting]
    
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
