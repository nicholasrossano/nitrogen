"""Chat API endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
import logging
import json
import asyncio

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
    ToolAlignmentSchema,
    AlignmentSectionSchema,
    AlignmentParameterSchema,
    AlignmentFeedbackRequest,
    AlignmentConfirmRequest,
    AlignmentResponse,
)
from app.services.chat_agent import ChatAgentService
from app.services.sdg_classifier import classify_sdg
from app.tools import get_tool_registry
from app.tools.base import ToolAlignment
from app.api.alignment_helpers import (
    get_or_generate_alignment,
    build_alignment_widget_data,
    build_deliverables_overview_data,
    get_alignment_intro_message,
    get_deliverables_overview_message,
)

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


@router.post("/initiatives/{initiative_id}/chat/stream")
async def send_chat_message_stream(
    initiative_id: UUID,
    data: ChatMessageCreate,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Send a chat message and get streaming assistant response."""
    
    async def generate_stream():
        try:
            # Get initiative
            result = await db.execute(
                select(Initiative).where(
                    Initiative.id == initiative_id,
                    Initiative.user_id == user.uid,
                )
            )
            initiative = result.scalar_one_or_none()
            
            if not initiative:
                yield f"data: {json.dumps({'error': 'Initiative not found'})}\n\n"
                return
            
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
            
            # Process message (simplified version of main endpoint logic)
            chat_agent = ChatAgentService()
            widget_type = None
            widget_data = None
            assistant_response = None
            
            # Generate response using chat agent
            assistant_response = await chat_agent.generate_response(
                messages=messages,
                initiative=initiative,
                widget_type=widget_type,
            )
            
            # Stream the response word by word
            words = assistant_response.split()
            for i, word in enumerate(words):
                chunk_data = {
                    "type": "word",
                    "content": word,
                    "is_last": i == len(words) - 1
                }
                yield f"data: {json.dumps(chunk_data)}\n\n"
                await asyncio.sleep(0.03)  # 30ms delay between words (faster pace)
            
            # Save assistant message to database
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
            
            # Send final metadata
            final_data = {
                "type": "complete",
                "message": {
                    "id": str(assistant_message.id),
                    "role": assistant_message.role,
                    "content": assistant_message.content,
                    "widget_type": assistant_message.widget_type,
                    "widget_data": assistant_message.widget_data,
                    "created_at": assistant_message.created_at.isoformat(),
                },
                "stage_status": build_stage_status(initiative).__dict__,
            }
            yield f"data: {json.dumps(final_data)}\n\n"
            
        except Exception as e:
            logging.error(f"Stream error: {e}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
    
    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
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
    has_alignment_widget = any(
        m.widget_type == "alignment" for m in messages if m.role == "assistant"
    )
    
    # Get last assistant message
    last_assistant_msg = None
    for msg in reversed(messages):
        if msg.role == "assistant":
            last_assistant_msg = msg
            break
    
    logging.info(f"ONBOARDING STATE: user_msgs={user_message_count}, has_doc_request={has_document_request}, has_tools={has_tool_checklist}, has_alignment={has_alignment_widget}")
    
    # ============================================================
    # STAGE 1: First user message -> Ask for materials
    # Trigger: user_message_count == 1 AND no document_request yet
    # ============================================================
    if user_message_count == 1 and not has_document_request:
        logging.info("STAGE 1: Asking for materials")
        
        # Extract and save project info
        try:
            project_info = await chat_agent.extract_project_info(messages)
            if project_info.get("project_description"):
                initiative.project_description = project_info["project_description"]
            if project_info.get("project_type"):
                initiative.project_type = project_info["project_type"]
            if project_info.get("title") and not initiative.title:
                initiative.title = project_info["title"]
                # Always select an icon when we set the title
                icon = await chat_agent.select_project_icon(
                    project_info["title"],
                    project_info.get("project_description", "")
                )
                initiative.icon = icon
            if project_info.get("geography") and not initiative.geography:
                initiative.geography = project_info["geography"]
            await db.commit()
            await db.refresh(initiative)
        except Exception as e:
            logging.error(f"Project extraction failed: {e}")
        
        # Scripted materials request (no LLM)
        assistant_response = "Do you have existing materials you want to upload to streamline the research process?"
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
            confirmation_msg = f"I received and processed {len(docs)} document{'s' if len(docs) > 1 else ''}: {doc_names}."
            if preview_text:
                try:
                    summary = await chat_agent.quick_doc_summary(preview_text)
                    confirmation_msg += f" {summary}"
                except:
                    confirmation_msg += " I'll use this to create more accurate outputs."
        else:
            confirmation_msg = "I can create documentation based on our conversation. I may need to make some assumptions, but I'll flag those for you."
        
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
        
        # Check if user wants to go back to tool selection
        wants_to_go_back = analysis.get("wants_to_go_back", False)
        user_msg_lower = data.content.lower()
        is_tool_change_request = any(phrase in user_msg_lower for phrase in [
            "change my tool", "modify tool", "different tool", "change tool",
            "go back", "change selection", "modify selection", "add more tool",
            "remove tool", "change deliverable", "modify deliverable"
        ])
        
        if wants_to_go_back or is_tool_change_request:
            logging.info("User wants to modify tool selection - showing tool checklist")
            
            # Clear existing alignments since tools may change
            initiative.tool_alignments = None
            await db.commit()
            await db.refresh(initiative)
            
            assistant_response = "No problem! Here are the available tools - you can adjust your selection:"
            widget_type = "tool_checklist"
            registry = get_tool_registry()
            recommendations = registry.recommend_tools(
                project_description=initiative.project_description,
                project_type=initiative.project_type,
            )
            # Pre-select currently selected tools
            selected_tool_ids = set(initiative.selected_tools or [])
            widget_data = {
                "recommendations": [
                    {
                        "tool": tool.definition.to_dict(),
                        "confidence": confidence,
                        "recommended": tool.definition.id in selected_tool_ids or confidence > 0.3,
                    }
                    for tool, confidence in recommendations
                ],
                "project_type": initiative.project_type,
            }
        else:
            # Update initiative with any extracted info
            info_updated = False
            if analysis.get("project_description") and not initiative.project_description:
                initiative.project_description = analysis["project_description"]
                info_updated = True
            if analysis.get("project_type") and analysis["project_type"] and not initiative.project_type:
                initiative.project_type = analysis["project_type"]
                info_updated = True
            if analysis.get("title") and not initiative.title:
                initiative.title = analysis["title"]
                # Always select an icon when we set the title
                icon = await chat_agent.select_project_icon(
                    analysis["title"],
                    analysis.get("project_description", "")
                )
                initiative.icon = icon
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
                    registry = get_tool_registry()
                    
                    # Check for pending alignments first
                    pending_alignment_tools = initiative.get_pending_alignment_tools()
                    
                    if pending_alignment_tools:
                        # Show alignment widget for the first tool needing alignment
                        tool_id = pending_alignment_tools[0]
                        tool = registry.get_tool(tool_id)
                        
                        if tool and tool.requires_alignment:
                            alignment_data = await get_or_generate_alignment(db, initiative, tool_id)
                            
                            if alignment_data:
                                widget_type = "alignment"
                                widget_data = build_alignment_widget_data(
                                    tool_id=tool_id,
                                    alignment_data=alignment_data,
                                    pending_tool_ids=pending_alignment_tools[1:],
                                )
                                assistant_response = get_alignment_intro_message(tool.definition.name)
                    
                    # If no pending alignments (or alignment generation failed), show deliverables overview
                    if widget_type is None:
                        widget_type = "deliverables_overview"
                        widget_data = build_deliverables_overview_data(initiative)
    
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
    
    # Rehydrate tool_checklist widget_data with current tool definitions
    # (stored data may have stale descriptions from when the message was created)
    registry = get_tool_registry()
    tools_by_id = {t.definition.id: t.definition for t in registry.get_all_tools()}
    
    def rehydrate_widget_data(widget_data: dict | None) -> dict | None:
        if not widget_data or "recommendations" not in widget_data:
            return widget_data
        recs = []
        for r in widget_data["recommendations"]:
            tool_data = r.get("tool") or {}
            tool_id = tool_data.get("id")
            current_def = tools_by_id.get(tool_id) if tool_id else None
            if current_def:
                recs.append({
                    **r,
                    "tool": current_def.to_dict(),
                })
            else:
                recs.append(r)
        return {**widget_data, "recommendations": recs}
    
    # If no messages, add initial greeting
    if not messages:
        greeting = ChatMessage(
            initiative_id=initiative_id,
            role="assistant",
            content="Briefly describe your project.",
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
                widget_data=rehydrate_widget_data(msg.widget_data) if msg.widget_type == "tool_checklist" else msg.widget_data,
                created_at=msg.created_at,
            )
            for msg in messages
        ],
        stage_status=build_stage_status(initiative),
    )


@router.post("/initiatives/{initiative_id}/alignment/confirm", response_model=AlignmentResponse)
async def confirm_alignment(
    initiative_id: UUID,
    data: AlignmentConfirmRequest,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Confirm an alignment, optionally with modifications."""
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
    
    # Get existing alignment
    alignment_data = initiative.get_alignment_for_tool(data.tool_id)
    if not alignment_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No alignment found for tool {data.tool_id}",
        )
    
    # Apply modifications if provided
    if data.sections:
        alignment_data["sections"] = [s.model_dump() for s in data.sections]
    if data.parameters:
        alignment_data["parameters"] = [p.model_dump() for p in data.parameters]
    
    # Mark as confirmed
    alignment_data["confirmed"] = True
    alignment_data["feedback"] = None
    
    # Save updated alignment
    initiative.set_alignment_for_tool(data.tool_id, alignment_data)
    await db.commit()
    await db.refresh(initiative)
    
    # Add confirmation message to chat
    registry = get_tool_registry()
    tool = registry.get_tool(data.tool_id)
    tool_name = tool.definition.name if tool else data.tool_id
    
    # Check if there are more alignments needed
    pending = initiative.get_pending_alignment_tools()
    widget_type = None
    widget_data = None
    
    if pending:
        # Show alignment widget for the next tool
        next_tool_id = pending[0]
        next_tool = registry.get_tool(next_tool_id)
        
        if next_tool and next_tool.requires_alignment:
            next_alignment_data = await get_or_generate_alignment(db, initiative, next_tool_id)
            
            if next_alignment_data:
                widget_type = "alignment"
                widget_data = build_alignment_widget_data(
                    tool_id=next_tool_id,
                    alignment_data=next_alignment_data,
                    pending_tool_ids=pending[1:],
                )
                message = f"Great, I've confirmed the {tool_name} outline. {get_alignment_intro_message(next_tool.definition.name)}"
            else:
                # Alignment generation failed, fall through to deliverables overview
                pending = []
        
        if not widget_type:
            next_tool_name = next_tool.definition.name if next_tool else pending[0]
            message = f"Great, I've confirmed the {tool_name} outline. Let's review the {next_tool_name} next."
    
    # If no pending alignments, show deliverables overview
    if not pending:
        widget_type = "deliverables_overview"
        widget_data = build_deliverables_overview_data(initiative)
        tool_names = [registry.get_tool(tid).definition.name for tid in (initiative.selected_tools or []) if registry.get_tool(tid)]
        message = f"Perfect! The {tool_name} outline is confirmed. {get_deliverables_overview_message(tool_names)}"
    
    # Save assistant message
    assistant_message = ChatMessage(
        initiative_id=initiative.id,
        role="assistant",
        content=message,
        widget_type=widget_type,
        widget_data=widget_data,
    )
    db.add(assistant_message)
    await db.commit()
    
    return AlignmentResponse(
        alignment=ToolAlignmentSchema(**alignment_data),
        message=message,
    )


@router.post("/initiatives/{initiative_id}/alignment/feedback", response_model=AlignmentResponse)
async def provide_alignment_feedback(
    initiative_id: UUID,
    data: AlignmentFeedbackRequest,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Provide feedback to update an alignment."""
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
    
    # Get existing alignment
    alignment_data = initiative.get_alignment_for_tool(data.tool_id)
    if not alignment_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No alignment found for tool {data.tool_id}",
        )
    
    # Get the tool and update alignment based on feedback
    registry = get_tool_registry()
    tool = registry.get_tool(data.tool_id)
    
    if not tool:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Tool {data.tool_id} not found",
        )
    
    # Reconstruct alignment object
    current_alignment = ToolAlignment.from_dict(alignment_data)
    
    # Update alignment based on feedback
    try:
        updated_alignment = await tool.update_alignment_from_feedback(
            current_alignment=current_alignment,
            feedback=data.feedback,
            db=db,
            initiative_id=initiative_id,
        )
        updated_data = updated_alignment.to_dict()
    except Exception as e:
        logging.error(f"Failed to update alignment from feedback: {e}")
        # Just store the feedback and let user try again
        alignment_data["feedback"] = data.feedback
        updated_data = alignment_data
    
    # Save updated alignment
    initiative.set_alignment_for_tool(data.tool_id, updated_data)
    await db.commit()
    await db.refresh(initiative)
    
    # Save user's feedback as a chat message
    user_msg = ChatMessage(
        initiative_id=initiative.id,
        role="user",
        content=data.feedback,
    )
    db.add(user_msg)
    await db.commit()
    
    # Save assistant response
    tool_name = tool.definition.name
    pending = initiative.get_pending_alignment_tools()
    # Remove current tool from pending list for widget
    pending_others = [tid for tid in pending if tid != data.tool_id]
    
    assistant_message = ChatMessage(
        initiative_id=initiative.id,
        role="assistant",
        content=f"I've updated the {tool_name} outline based on your feedback. Please review the changes.",
        widget_type="alignment",
        widget_data=build_alignment_widget_data(
            tool_id=data.tool_id,
            alignment_data=updated_data,
            pending_tool_ids=pending_others,
        ),
    )
    db.add(assistant_message)
    await db.commit()
    
    return AlignmentResponse(
        alignment=ToolAlignmentSchema(**updated_data),
        message=f"Updated {tool_name} outline based on your feedback.",
    )


@router.get("/initiatives/{initiative_id}/alignment/{tool_id}")
async def get_alignment(
    initiative_id: UUID,
    tool_id: str,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Get the current alignment for a specific tool."""
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
    
    # Get alignment
    alignment_data = initiative.get_alignment_for_tool(tool_id)
    
    if not alignment_data:
        # Generate alignment if it doesn't exist
        registry = get_tool_registry()
        tool = registry.get_tool(tool_id)
        
        if not tool:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Tool {tool_id} not found",
            )
        
        if not tool.requires_alignment:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Tool {tool_id} does not require alignment",
            )
        
        try:
            alignment_obj = await tool.generate_alignment(
                db=db,
                initiative_id=initiative_id,
                inputs=initiative.tool_inputs or {},
            )
            alignment_data = alignment_obj.to_dict()
            
            # Save alignment to initiative
            initiative.set_alignment_for_tool(tool_id, alignment_data)
            await db.commit()
            await db.refresh(initiative)
        except Exception as e:
            logging.error(f"Failed to generate alignment for {tool_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to generate alignment: {str(e)}",
            )
    
    return {
        "alignment": alignment_data,
        "tool_id": tool_id,
    }
