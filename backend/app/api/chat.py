"""Chat API endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from app.core.database import get_db
from app.core.auth import get_current_user, MockUser
from app.models.initiative import Initiative, InitiativeStage
from app.models.chat import ChatMessage
from app.models.evidence import EvidenceDoc
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
    
    # ============================================================
    # DETERMINISTIC ONBOARDING STATE MACHINE
    # No LLM for flow control - just simple, reliable logic
    # ============================================================
    
    chat_agent = ChatAgentService()
    widget_type = None
    widget_data = None
    should_show_tools_next = False
    assistant_response = None
    
    # Count message types to determine stage
    user_message_count = sum(1 for m in messages if m.role == "user")
    
    # Check for key widgets in history
    has_document_request = any(
        m.widget_type == "document_request" for m in messages if m.role == "assistant"
    )
    has_tool_checklist = any(
        m.widget_type == "tool_checklist" for m in messages if m.role == "assistant"
    )
    
    # Get last assistant message
    last_assistant_msg = None
    for msg in reversed(messages):
        if msg.role == "assistant":
            last_assistant_msg = msg
            break
    
    import logging
    logging.info(f"ONBOARDING STATE: user_msgs={user_message_count}, has_doc_request={has_document_request}, has_tools={has_tool_checklist}")
    
    # ============================================================
    # STAGE 1: First user message -> Ask for materials
    # Trigger: user_message_count == 1 AND no document_request yet
    # ============================================================
    if user_message_count == 1 and not has_document_request:
        logging.info("STAGE 1: Asking for materials")
        
        # Get the user's project description
        user_description = data.content
        
        # Extract and save project info
        try:
            project_info = await chat_agent.extract_project_info(messages)
            if project_info.get("project_description"):
                initiative.project_description = project_info["project_description"]
            if project_info.get("project_type"):
                initiative.project_type = project_info["project_type"]
            if project_info.get("title") and not initiative.title:
                initiative.title = project_info["title"]
            if project_info.get("geography") and not initiative.geography:
                initiative.geography = project_info["geography"]
            await db.commit()
            await db.refresh(initiative)
        except Exception as e:
            logging.error(f"Project extraction failed: {e}")
        
        # LLM generates the materials request with context-appropriate details
        assistant_response = await chat_agent.generate_materials_request_v2(user_description)
        widget_type = "document_request"
        widget_data = {"allow_multiple": True}
    
    # ============================================================
    # STAGE 2: User responded to document request -> Confirm docs + show tools
    # Trigger: last message was document_request widget AND user just responded
    # ============================================================
    elif last_assistant_msg and last_assistant_msg.widget_type == "document_request" and not has_tool_checklist:
        logging.info("STAGE 2: Confirming documents and showing tools")
        
        # Get uploaded documents
        docs_result = await db.execute(
            select(EvidenceDoc).where(EvidenceDoc.initiative_id == initiative_id)
        )
        docs = list(docs_result.scalars().all())
        
        # Build confirmation message
        if docs:
            # Get preview of first document
            from app.models.evidence import EvidenceChunk
            preview_text = ""
            chunks_result = await db.execute(
                select(EvidenceChunk)
                .where(EvidenceChunk.evidence_doc_id == docs[0].id)
                .order_by(EvidenceChunk.chunk_index)
                .limit(1)
            )
            first_chunk = chunks_result.scalar_one_or_none()
            if first_chunk:
                preview_text = first_chunk.content[:200].replace('\n', ' ').strip()
            
            doc_names = ", ".join([d.filename for d in docs])
            confirmation_msg = f"Thanks! I've received and processed {len(docs)} document{'s' if len(docs) > 1 else ''}: {doc_names}."
            if preview_text:
                try:
                    summary = await chat_agent.quick_doc_summary(preview_text)
                    confirmation_msg += f" {summary}"
                except:
                    confirmation_msg += " I'll use this to create more accurate outputs."
        else:
            confirmation_msg = "No problem! I can create documentation based on our conversation. I may need to make some assumptions, but I'll flag those for you."
        
        # Save the confirmation message FIRST (no widget)
        confirmation_message = ChatMessage(
            initiative_id=initiative.id,
            role="assistant",
            content=confirmation_msg,
            widget_type=None,
            widget_data=None,
        )
        db.add(confirmation_message)
        await db.commit()
        
        # Now prepare the tool recommendations message
        assistant_response = "Based on your project, here are the tools I recommend:"
        
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
    
    # ============================================================
    # DEFAULT: Use LLM for everything after onboarding
    # ============================================================
    else:
        logging.info("DEFAULT: Using LLM for response")
        
        # Analyze intent only for post-onboarding
        try:
            analysis = await chat_agent.analyze_intent(messages, initiative)
        except:
            analysis = {"intent": "general_conversation"}
        
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
            await db.commit()
            await db.refresh(initiative)
        
        # If tools are selected, extract any tool-specific inputs from conversation
        is_just_asking = analysis.get("intent") == "asking_question"
        if initiative.selected_tools and not is_just_asking:
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
    
    # Generate assistant response ONLY if not already set by deterministic stages
    if assistant_response is None:
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
        trigger_tools_next=locals().get('should_show_tools_next', False),
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
