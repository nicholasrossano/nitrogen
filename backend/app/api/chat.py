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
from app.services.sdg_classifier import classify_sdg
from app.tools import get_tool_registry

router = APIRouter()


def build_stage_status(initiative: Initiative) -> StageStatus:
    """Build stage status from initiative."""
    missing = []
    
    # Check for missing tool inputs if tools are selected
    if initiative.selected_tools:
        missing_inputs = initiative.get_missing_tool_inputs()
        for tool_id, fields in missing_inputs.items():
            missing.extend(fields)
    else:
        # Basic fields for project description
        if not initiative.project_description and not initiative.title:
            missing.append("project_description")
    
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
    
    # Process message with chat agent
    chat_agent = ChatAgentService()
    widget_type = None
    widget_data = None
    
    # Analyze user intent and extract information
    try:
        analysis = await chat_agent.analyze_intent(messages, initiative)
    except Exception as e:
        # If analysis fails, provide defaults and log the error
        import logging
        logging.error(f"Intent analysis failed: {e}")
        analysis = {
            "intent": "describing_project",
            "ready_for_tools": False,
            "is_question": False,
            "wants_to_proceed": False,
            "wants_to_go_back": False,
        }
    
    # Check if user wants to go back or change something
    if analysis.get("wants_to_go_back", False):
        # Don't show any widgets, just let them have a conversation
        widget_type = None
        widget_data = None
    else:
        # Update initiative with any extracted info
        info_updated = False
        if analysis.get("project_description") and not initiative.project_description:
            initiative.project_description = analysis["project_description"]
            info_updated = True
        if analysis.get("project_type") and analysis["project_type"] and not initiative.project_type:
            initiative.project_type = analysis["project_type"]
            info_updated = True
        if analysis.get("geography") and not initiative.geography:
            initiative.geography = analysis["geography"]
            info_updated = True
        if analysis.get("target_beneficiaries") and not initiative.target_population:
            initiative.target_population = analysis["target_beneficiaries"]
            info_updated = True
        if analysis.get("project_goal") and not initiative.goal:
            initiative.goal = analysis["project_goal"]
            info_updated = True
        
        if info_updated:
            # Classify SDG if we have project info
            if initiative.project_description or initiative.goal:
                sdg_info = classify_sdg(
                    initiative.project_description or initiative.goal or "",
                    initiative.project_type,
                )
                if sdg_info:
                    tool_inputs = initiative.tool_inputs or {}
                    tool_inputs["sdg"] = sdg_info
                    initiative.tool_inputs = tool_inputs
            
            await db.commit()
            await db.refresh(initiative)
        
        # Determine if we should show tool recommendations
        # Be AGGRESSIVE: Show tools if:
        # 1. User described a project (has info in analysis OR initiative)
        # 2. Haven't selected tools yet
        # 3. Not explicitly just asking a general question
        
        is_just_asking = analysis.get("intent") == "asking_question"
        described_project = analysis.get("intent") in ["describing_project", "providing_info"]
        has_any_project_info = (
            initiative.project_description or 
            initiative.title or 
            analysis.get("project_description") or 
            analysis.get("title") or
            described_project
        )
        
        # Show tools if they mentioned a project at all, UNLESS they're just asking a question
        show_tool_recommendations = (
            has_any_project_info and
            not initiative.selected_tools and
            not is_just_asking
        )
        
        import logging
        logging.info(f"Tool recommendation logic: has_any_project_info={has_any_project_info}, selected_tools={initiative.selected_tools}, is_just_asking={is_just_asking}, show={show_tool_recommendations}")
        
        if show_tool_recommendations:
            # Do a full extraction to ensure we have all info before showing tools
            project_info = await chat_agent.extract_project_info(messages)
            logging.info(f"Extracted project info: {project_info}")
            
            # Update with extracted info
            if project_info.get("project_description"):
                initiative.project_description = project_info["project_description"]
            if project_info.get("project_type"):
                initiative.project_type = project_info["project_type"]
            # Set title when showing tool recommendations (user has provided enough context)
            if project_info.get("title") and not initiative.title:
                initiative.title = project_info["title"]
            if project_info.get("geography") and not initiative.geography:
                initiative.geography = project_info["geography"]
            if project_info.get("target_beneficiaries") and not initiative.target_population:
                initiative.target_population = project_info["target_beneficiaries"]
            if project_info.get("project_goal") and not initiative.goal:
                initiative.goal = project_info["project_goal"]
            
            await db.commit()
            await db.refresh(initiative)
            
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
        
        # If tools are selected, extract any tool-specific inputs from conversation
        elif initiative.selected_tools and not is_just_asking:
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
            if tool_inputs.get("project_title") and not initiative.title:
                initiative.title = tool_inputs["project_title"]
            if tool_inputs.get("geography") and not initiative.geography:
                initiative.geography = tool_inputs["geography"]
            if tool_inputs.get("target_beneficiaries") and not initiative.target_population:
                initiative.target_population = tool_inputs["target_beneficiaries"]
            if tool_inputs.get("project_goal") and not initiative.goal:
                initiative.goal = tool_inputs["project_goal"]
            
            await db.commit()
            await db.refresh(initiative)
            
            # Only show deliverables overview if user explicitly wants to proceed OR all inputs are ready and they're providing final info
            missing = initiative.get_missing_tool_inputs()
            wants_to_proceed = analysis.get("wants_to_proceed", False)
            is_providing_info = analysis.get("intent") in ["describing_project", "providing_info"]
            
            if not missing and (wants_to_proceed or is_providing_info):
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
        extracted_fields=None,
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
            content="Hi! I help development teams prepare investment memos and due diligence checklists for impact projects. What are you working on?",
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
