"""Chat API endpoints with LLM-driven orchestration."""

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
    SourceCitation,
)
from app.services.orchestration import OrchestrationService
from app.services.chat_agent import ChatAgentService
from app.services.compliance_chat import ComplianceChatService
from app.services.project_plan import ProjectPlanService
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
logger = logging.getLogger(__name__)


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


def build_tool_recommendations(registry, tool_ids: list[str], initiative: Initiative) -> dict:
    """Build tool recommendations widget data from tool IDs."""
    all_tools = registry.get_all_tools()
    tools_by_id = {t.definition.id: t for t in all_tools}
    
    recommendations = []
    for tool in all_tools:
        is_recommended = tool.definition.id in tool_ids
        recommendations.append({
            "tool": tool.definition.to_dict(),
            "confidence": 1.0 if is_recommended else 0.3,
            "recommended": is_recommended,
        })
    
    return {
        "recommendations": recommendations,
        "project_type": initiative.project_type,
    }


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

            # Use orchestration service
            orchestration = OrchestrationService(db)

            # Extract inputs from the user's message first
            extracted = await orchestration.extract_inputs_from_message(
                message=data.content,
                initiative=initiative,
            )
            await update_initiative_from_inputs(db, initiative, extracted, orchestration)

            action_result = await orchestration.get_next_action(
                messages=messages,
                initiative=initiative,
            )

            # Send a thinking indicator for heavy actions
            if action_result.action == "generate_project_plan":
                yield f"data: {json.dumps({'type': 'thinking', 'content': 'Generating your project plan...'})}\n\n"
            elif action_result.action == "run_lcoe_tool":
                yield f"data: {json.dumps({'type': 'thinking', 'content': 'Building your LCOE model...'})}\n\n"
            elif action_result.action == "run_carbon_tool":
                yield f"data: {json.dumps({'type': 'thinking', 'content': 'Building your carbon emissions model...'})}\n\n"

            # Execute the action
            widget_type, widget_data, assistant_response, sources = await execute_action(
                db, initiative, action_result, orchestration, chat_history=messages
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
                await asyncio.sleep(0.03)
            
            # Save assistant message to database
            assistant_message = ChatMessage(
                initiative_id=initiative.id,
                role="assistant",
                content=assistant_response,
                widget_type=widget_type,
                widget_data=widget_data,
                sources=[s.to_dict() for s in action_result.sources_used] if action_result.sources_used else None,
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
                    "sources": assistant_message.sources,
                    "created_at": assistant_message.created_at.isoformat(),
                },
                "stage_status": build_stage_status(initiative).__dict__,
            }
            yield f"data: {json.dumps(final_data)}\n\n"
            
        except Exception as e:
            logger.error(f"Stream error: {e}", exc_info=True)
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


def _build_project_context(initiative: Initiative) -> str:
    """Build a project context string to inject into the research assistant."""
    parts = []
    if initiative.title:
        parts.append(f"- Title: {initiative.title}")
    if initiative.project_type:
        parts.append(f"- Project type: {initiative.project_type}")
    if initiative.project_description:
        parts.append(f"- Description: {initiative.project_description[:600]}")
    if initiative.geography:
        parts.append(f"- Geography: {initiative.geography}")
    if initiative.selected_tools:
        parts.append(f"- Selected tools/frameworks: {', '.join(initiative.selected_tools)}")
    if initiative.goal:
        parts.append(f"- Goal: {initiative.goal}")
    return "\n".join(parts) if parts else ""


async def execute_action(
    db: AsyncSession,
    initiative: Initiative,
    action_result,
    orchestration: OrchestrationService,
    chat_history: list | None = None,
) -> tuple[str | None, dict | None, str, list]:
    """
    Execute an orchestration action and return widget/response.

    Returns:
        (widget_type, widget_data, assistant_response, sources)
    """
    action = action_result.action
    params = action_result.parameters
    sources = action_result.sources_used

    widget_type = None
    widget_data = None
    assistant_response = params.get("message", "")

    logger.info(f"Executing action: {action}")

    if action == "send_message":
        # Run the full research pipeline (RAG + OpenAlex + web) with project context,
        # giving the project chat the same research capabilities as the central chat.
        project_context = _build_project_context(initiative)
        history_dicts = []
        if chat_history:
            history_dicts = [
                {"role": m.role, "content": m.content}
                for m in chat_history[-20:]
                if m.role in ("user", "assistant")
            ]
        # Drop the last user message from history (it's passed as user_message below)
        if history_dicts and history_dicts[-1]["role"] == "user":
            history_dicts = history_dicts[:-1]

        # Extract the actual user message from the most recent user turn
        user_message = params.get("message", "")
        if chat_history:
            for m in reversed(chat_history):
                if m.role == "user":
                    user_message = m.content
                    break

        try:
            research_service = ComplianceChatService(db)
            research_result = await research_service.generate_response(
                user_message=user_message,
                history=history_dicts,
                project_context=project_context if project_context else None,
            )
            assistant_response = research_result.content
            sources = research_result.sources
            if research_result.widget_type:
                widget_type = research_result.widget_type
                widget_data = research_result.widget_data
        except Exception as e:
            logger.error(f"Research pipeline failed for send_message, falling back: {e}")
            # Fall back to the orchestration-generated message

    elif action == "ask_for_documents":
        widget_type = "document_request"
        widget_data = {
            "allow_multiple": True,
            "suggested_types": params.get("suggested_types", []),
        }

    elif action == "ask_clarifying_questions":
        widget_type = "clarifying_questions"
        widget_data = {
            "fields_needed": params.get("fields_needed", []),
        }

    elif action == "generate_project_plan":
        plan_service = ProjectPlanService(db)
        existing_plan = initiative.project_plan
        try:
            plan_data = await plan_service.generate(
                initiative=initiative,
                existing_plan=existing_plan,
            )
            initiative.project_plan = plan_data
            if initiative.stage in (InitiativeStage.DESCRIBE,):
                initiative.stage = InitiativeStage.PLAN
            await db.commit()
            await db.refresh(initiative)

            total_items = sum(
                len(p.get("items", [])) for p in plan_data.get("pillars", [])
            )
            widget_type = "project_plan"
            widget_data = {
                "plan": plan_data,
                "summary": {
                    "total_items": total_items,
                    "pillars": [
                        {
                            "id": p["id"],
                            "name": p["name"],
                            "item_count": len(p.get("items", [])),
                        }
                        for p in plan_data.get("pillars", [])
                    ],
                },
            }
        except Exception as e:
            logger.error(f"Project plan generation failed: {e}", exc_info=True)
            assistant_response = "I wasn't able to generate the project plan right now. Could you provide a bit more detail about your project so I can try again?"
            widget_type = None
            widget_data = None

    elif action == "update_project_plan":
        plan_service = ProjectPlanService(db)
        existing_plan = initiative.project_plan
        user_request = params.get("user_request", "")
        try:
            plan_data = await plan_service.generate(
                initiative=initiative,
                existing_plan=existing_plan,
                user_request=user_request,
            )
            initiative.project_plan = plan_data
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(initiative, "project_plan")
            await db.commit()
            await db.refresh(initiative)

            total_items = sum(
                len(p.get("items", [])) for p in plan_data.get("pillars", [])
            )
            widget_type = "project_plan"
            widget_data = {
                "plan": plan_data,
                "summary": {
                    "total_items": total_items,
                    "pillars": [
                        {
                            "id": p["id"],
                            "name": p["name"],
                            "item_count": len(p.get("items", [])),
                        }
                        for p in plan_data.get("pillars", [])
                    ],
                },
            }
        except Exception as e:
            logger.error(f"Project plan update failed: {e}", exc_info=True)
            assistant_response = "I wasn't able to update the project plan right now. Please try again."
            widget_type = None
            widget_data = None

    elif action == "run_lcoe_tool":
        from app.tools.lcoe_tool import LCOETool
        lcoe_tool = LCOETool()
        try:
            yield_msg = params.get("message", "Building your LCOE model…")
            tool_output = await lcoe_tool.execute(
                db=db,
                initiative_id=initiative.id,
                inputs=initiative.tool_inputs or {},
            )
            content = tool_output.content
            computable = content.get("computable", False)

            if computable and content.get("result"):
                lcoe_val = content["result"]["lcoe"]
                currency = content["result"].get("currency", "USD")
                assumption_count = content["result"].get("assumption_count", 0)
                quality = content["result"].get("quality_label", "moderate")

                widget_type = "lcoe_output"
                widget_data = content
                assistant_response = (
                    f"{yield_msg}\n\n"
                    f"**LCOE: {currency} {lcoe_val:.4f}/kWh** "
                    f"({assumption_count} assumption{'s' if assumption_count != 1 else ''}, "
                    f"{quality} confidence). "
                    "Review the inputs below — you can edit any value and I'll recalculate instantly."
                )
            else:
                missing = content.get("missing_essentials", [])
                widget_type = "lcoe_inputs"
                widget_data = content
                missing_labels = {
                    "net_capacity_kw": "net capacity (kW)",
                    "total_capex": "total CAPEX",
                    "annual_opex": "annual O&M cost",
                }
                nice_names = [missing_labels.get(m, m) for m in missing]
                assistant_response = (
                    f"{yield_msg}\n\n"
                    f"I've pre-filled what I could from our conversation. "
                    f"To calculate the LCOE I still need: **{', '.join(nice_names)}**. "
                    "Can you provide these?"
                )
        except Exception as e:
            logger.error(f"LCOE tool failed: {e}", exc_info=True)
            assistant_response = "I wasn't able to build the LCOE model right now. Could you provide more details about the project costs and capacity?"
            widget_type = None
            widget_data = None

    elif action == "run_carbon_tool":
        from app.tools.carbon_tool import CarbonTool
        carbon_tool = CarbonTool()
        try:
            yield_msg = params.get("message", "Building your carbon emissions model…")
            tool_output = await carbon_tool.execute(
                db=db,
                initiative_id=initiative.id,
                inputs=initiative.tool_inputs or {},
            )
            content = tool_output.content
            computable = content.get("computable", False)

            if computable and content.get("result"):
                net_er = content["result"]["net_er_tco2e"]
                assumption_count = content["result"].get("assumption_count", 0)
                quality = content["result"].get("quality_label", "moderate")

                widget_type = "carbon_output"
                widget_data = content
                assistant_response = (
                    f"{yield_msg}\n\n"
                    f"**Net Emission Reductions: {net_er:,.2f} tCO₂e/year** "
                    f"({assumption_count} assumption{'s' if assumption_count != 1 else ''}, "
                    f"{quality} confidence). "
                    "Review the inputs below — you can edit any value and I'll recalculate instantly."
                )
            else:
                missing = content.get("missing_essentials", [])
                widget_type = "carbon_inputs"
                widget_data = content
                missing_labels = {
                    "devices_households": "number of devices/households",
                    "baseline_fuel_consumption_kg_yr": "baseline fuel consumption (kg/yr)",
                }
                nice_names = [missing_labels.get(m, m) for m in missing]
                assistant_response = (
                    f"{yield_msg}\n\n"
                    f"I've pre-filled what I could from our conversation. "
                    f"To calculate emission reductions I still need: **{', '.join(nice_names)}**. "
                    "Can you provide these?"
                )
        except Exception as e:
            logger.error(f"Carbon tool failed: {e}", exc_info=True)
            assistant_response = "I wasn't able to build the carbon emissions model right now. Could you provide more details about the project?"
            widget_type = None
            widget_data = None

    return widget_type, widget_data, assistant_response, sources


async def update_initiative_from_inputs(
    db: AsyncSession,
    initiative: Initiative,
    extracted: dict,
    orchestration: OrchestrationService,
) -> None:
    """Update initiative with extracted inputs from conversation."""
    if not extracted:
        return

    updated = False

    if extracted.get("project_title") and not initiative.title:
        initiative.title = extracted["project_title"]
        chat_agent = ChatAgentService()
        icon = await chat_agent.select_project_icon(
            extracted["project_title"],
            extracted.get("project_description", "")
        )
        initiative.icon = icon
        updated = True

    if extracted.get("geography") and not initiative.geography:
        initiative.geography = extracted["geography"]
        updated = True

    if extracted.get("project_description") and not initiative.project_description:
        initiative.project_description = extracted["project_description"]
        updated = True

    if extracted.get("project_type") and not initiative.project_type:
        initiative.project_type = extracted["project_type"]
        updated = True

    if extracted.get("target_beneficiaries") and not initiative.target_population:
        initiative.target_population = extracted["target_beneficiaries"]
        updated = True

    if extracted.get("project_goal") and not initiative.goal:
        initiative.goal = extracted["project_goal"]
        updated = True

    if updated:
        await db.commit()
        await db.refresh(initiative)


@router.post("/initiatives/{initiative_id}/chat", response_model=ChatResponse)
async def send_chat_message(
    initiative_id: UUID,
    data: ChatMessageCreate,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Send a chat message and get assistant response using LLM-driven orchestration."""
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
    initiative.touch()  # Update the initiative's updated_at timestamp
    await db.commit()
    
    # Get chat history
    history_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.initiative_id == initiative_id)
        .order_by(ChatMessage.created_at)
    )
    messages = list(history_result.scalars().all())
    
    # ============================================================
    # LLM-DRIVEN ORCHESTRATION
    # The LLM decides what action to take based on:
    # - Retrieved context (corpus RAG, web search)
    # - Project state
    # - Conversation history
    # ============================================================
    
    orchestration = OrchestrationService(db)
    
    # Extract inputs from the user's message first
    extracted = await orchestration.extract_inputs_from_message(
        message=data.content,
        initiative=initiative,
    )
    await update_initiative_from_inputs(db, initiative, extracted, orchestration)
    
    # Get the next action from the orchestration LLM
    action_result = await orchestration.get_next_action(
        messages=messages,
        initiative=initiative,
    )
    
    logger.info(f"Orchestration chose action: {action_result.action}")
    
    # Execute the action
    widget_type, widget_data, assistant_response, sources = await execute_action(
        db, initiative, action_result, orchestration, chat_history=messages
    )
    
    # Convert sources to citation format
    source_citations = [
        SourceCitation(
            source_type=s.source_type.value,
            source_title=s.source_title,
            source_url=s.source_url,
            chunk_id=s.chunk_id,
            confidence=s.confidence,
        )
        for s in sources
    ] if sources else None
    
    # Save assistant message
    assistant_message = ChatMessage(
        initiative_id=initiative.id,
        role="assistant",
        content=assistant_response,
        widget_type=widget_type,
        widget_data=widget_data,
        sources=[s.to_dict() for s in sources] if sources else None,
    )
    db.add(assistant_message)
    initiative.touch()  # Update the initiative's updated_at timestamp
    await db.commit()
    await db.refresh(assistant_message)
    
    return ChatResponse(
        message=ChatMessageResponse(
            id=assistant_message.id,
            role=assistant_message.role,
            content=assistant_message.content,
            widget_type=assistant_message.widget_type,
            widget_data=assistant_message.widget_data,
            sources=source_citations,
            created_at=assistant_message.created_at,
        ),
        extracted_fields=None,
        stage_status=build_stage_status(initiative),
        show_confirmation=widget_type == "deliverables_overview",
        trigger_tools_next=False,
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
            content="Describe your project and I'll map out the specific permits, certifications, and deliverables you'll need to move forward.",
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
                sources=[
                    SourceCitation(**s) for s in msg.sources
                ] if msg.sources else None,
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
        logger.error(f"Failed to update alignment from feedback: {e}")
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
            logger.error(f"Failed to generate alignment for {tool_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to generate alignment: {str(e)}",
            )
    
    return {
        "alignment": alignment_data,
        "tool_id": tool_id,
    }
