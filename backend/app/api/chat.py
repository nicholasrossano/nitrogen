"""Chat API endpoints with LLM-driven orchestration."""

import re

# Synthetic messages sent automatically by the UI that carry no real project info.
# Skipping input extraction for these prevents the LLM from inferring junk titles
# like "Document Upload" when initiative.title is still None.
_SKIP_EXTRACTION_MESSAGES = {
    "I've uploaded my documents.",
    "I don't have any documents to upload.",
}
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
import logging
import json
import asyncio

from app.core.database import get_db
from app.core.auth import get_current_user, AuthUser
from app.core.permissions import require_editor, require_viewer
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
    TruncateChatRequest,
    TruncateChatResponse,
    RetryResponse,
    MessageFeedbackRequest,
    MessageWidgetUpdateRequest,
)
from app.services.orchestration import OrchestrationService
from app.services.chat_agent import ChatAgentService
from app.services.core_chat import ComplianceChatService
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
    user: AuthUser = Depends(get_current_user),
):
    """Send a chat message and get streaming assistant response."""
    initiative = await require_editor(db, initiative_id, user)

    async def generate_stream():
        try:
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

            # Extract inputs from the user's message first (skip synthetic UI messages)
            if data.content not in _SKIP_EXTRACTION_MESSAGES:
                extracted = await orchestration.extract_inputs_from_message(
                    message=data.content,
                    initiative=initiative,
                )
                await update_initiative_from_inputs(db, initiative, extracted, orchestration)

            tool_hint = data.tool_hint or None
            action_result = await orchestration.get_next_action(
                messages=messages,
                initiative=initiative,
                tool_hint=tool_hint,
            )

            # Collect thinking lines from the research pipeline
            thinking_lines: list[str] = []
            thinking_queue: asyncio.Queue[str] = asyncio.Queue()

            async def on_thinking(text: str):
                thinking_lines.append(text)
                await thinking_queue.put(json.dumps({"type": "thinking", "text": text}))

            # Send a thinking indicator for heavy actions
            if action_result.action == "generate_project_plan":
                await on_thinking("Generating your project plan...")
            elif action_result.action == "run_lcoe_tool":
                await on_thinking("Building your LCOE model...")
            elif action_result.action == "run_carbon_tool":
                await on_thinking("Building your carbon emissions model...")
            elif action_result.action == "propose_input_value":
                await on_thinking("Researching a value for this input...")

            # Flush any queued thinking events before execute_action
            while not thinking_queue.empty():
                event_json = await thinking_queue.get()
                yield f"data: {event_json}\n\n"

            # Build model inputs context from the latest LCOE/Carbon widget in history
            from app.services.orchestration import OrchestrationService as _OrchestratorRef
            _model_inputs_ctx = _OrchestratorRef._format_model_inputs_from_messages(messages)

            # Execute the action with on_thinking callback for research pipeline
            generation_task = asyncio.create_task(
                execute_action(
                    db, initiative, action_result, orchestration,
                    chat_history=messages, tool_hint=tool_hint,
                    model_inputs_context=_model_inputs_ctx,
                    on_thinking=on_thinking,
                )
            )

            # Stream thinking events while the action runs
            while not generation_task.done():
                try:
                    event_json = await asyncio.wait_for(thinking_queue.get(), timeout=0.1)
                    yield f"data: {event_json}\n\n"
                except asyncio.TimeoutError:
                    continue

            # Flush remaining thinking events
            while not thinking_queue.empty():
                event_json = await thinking_queue.get()
                yield f"data: {event_json}\n\n"

            widget_type, widget_data, assistant_response, sources = generation_task.result()

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

            # Build completion metadata
            sources_list = [s.to_dict() for s in sources] if sources else None
            verified_count = len([s for s in sources if s.source_type.value != "llm_estimate"]) if sources else 0
            completion_meta = {
                "citation_count": verified_count,
                "tiers_used": list({s.source_type.value for s in sources}) if sources else [],
            }
            
            # Save assistant message to database
            assistant_message = ChatMessage(
                initiative_id=initiative.id,
                role="assistant",
                content=assistant_response,
                widget_type=widget_type,
                widget_data=widget_data,
                sources=sources_list,
                thinking_lines=thinking_lines if thinking_lines else None,
                completion_meta=completion_meta,
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
                    "thinking_lines": assistant_message.thinking_lines,
                    "completion_meta": assistant_message.completion_meta,
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


_ALIGNMENT_TOOL_NAMES: dict[str, str] = {
    "investment_memo": "Investment Memo",
    "due_diligence_checklist": "Due Diligence Checklist",
}


async def execute_action(
    db: AsyncSession,
    initiative: Initiative,
    action_result,
    orchestration: OrchestrationService,
    chat_history: list | None = None,
    tool_hint: str | None = None,
    model_inputs_context: str | None = None,
    on_thinking: Optional[Callable] = None,
) -> tuple[str | None, dict | None, str, list]:
    """
    Execute an orchestration action and return widget/response.

    Returns:
        (widget_type, widget_data, assistant_response, sources)
    """
    # Shortcut: if the user explicitly selected a document tool via the picker,
    # skip the tool-checklist widget and go straight to alignment (outline review).
    if tool_hint and tool_hint in _ALIGNMENT_TOOL_NAMES:
        registry = get_tool_registry()
        tool = registry.get_tool(tool_hint)
        if tool and tool.requires_alignment:
            from sqlalchemy.orm.attributes import flag_modified

            # Replace selected_tools with only this tool so a single-tool picker
            # action never pulls in other previously-selected tools that happen to
            # have confirmed alignments, which would cause both to be generated
            # simultaneously when this alignment is confirmed.
            existing = list(initiative.selected_tools or [])
            if existing != [tool_hint]:
                initiative.selected_tools = [tool_hint]
                # Clear the confirmed flag for any other tool that was previously
                # in selected_tools so stale alignments don't interfere.
                tool_alignments = dict(initiative.tool_alignments or {})
                for other_id in existing:
                    if other_id != tool_hint and other_id in tool_alignments:
                        del tool_alignments[other_id]
                initiative.tool_alignments = tool_alignments
                flag_modified(initiative, "selected_tools")
                flag_modified(initiative, "tool_alignments")
                await db.commit()
                await db.refresh(initiative)

            # Generate (or reuse) alignment and return the alignment widget
            alignment_data = await get_or_generate_alignment(db, initiative, tool_hint)
            if alignment_data:
                tool_name = _ALIGNMENT_TOOL_NAMES[tool_hint]
                pending = initiative.get_pending_alignment_tools()
                return (
                    "alignment",
                    build_alignment_widget_data(
                        tool_id=tool_hint,
                        alignment_data=alignment_data,
                        pending_tool_ids=[t for t in pending if t != tool_hint],
                    ),
                    get_alignment_intro_message(tool_name),
                    [],
                )

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
                model_inputs_context=model_inputs_context,
                on_thinking=on_thinking,
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
        try:
            categories = await plan_service.propose_categories(initiative=initiative, chat_history=chat_history)
            widget_type = "plan_categories"
            widget_data = {"categories": categories}
        except Exception as e:
            logger.error(f"Category proposal failed: {e}", exc_info=True)
            assistant_response = "I wasn't able to analyze the project right now. Could you provide a bit more detail so I can try again?"
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

            if computable and content.get("result") and content.get("inputs"):
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

                initiative.save_deliverable(
                    "lcoe_model",
                    f"LCOE Model ({currency} {lcoe_val:.4f}/kWh)",
                    "lcoe",
                    content,
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

            if computable and content.get("result") and content.get("inputs"):
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

                initiative.save_deliverable(
                    "carbon_model",
                    f"Carbon ER Model ({net_er:,.2f} tCO₂e/yr)",
                    "carbon",
                    content,
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

    elif action == "propose_input_value":
        # Use the research pipeline to generate the answer, then extract the concrete value
        project_context = _build_project_context(initiative)
        history_dicts = []
        if chat_history:
            history_dicts = [
                {"role": m.role, "content": m.content}
                for m in chat_history[-20:]
                if m.role in ("user", "assistant")
            ]
            if history_dicts and history_dicts[-1]["role"] == "user":
                history_dicts = history_dicts[:-1]

        user_message = params.get("message", "")
        if chat_history:
            for m in reversed(chat_history):
                if m.role == "user":
                    user_message = m.content
                    break

        try:
            from app.services.core_chat import ComplianceChatService
            research_service = ComplianceChatService(db)
            research_result = await research_service.generate_response(
                user_message=user_message,
                history=history_dicts,
                project_context=project_context if project_context else None,
                model_inputs_context=model_inputs_context,
                on_thinking=on_thinking,
            )
            assistant_response = research_result.content
            sources = research_result.sources
            if research_result.widget_type == "proposed_value":
                widget_type = research_result.widget_type
                widget_data = research_result.widget_data
            else:
                # Fallback: try extraction directly
                hint_field = params.get("field_name")
                hint_model = params.get("model_type", "lcoe")
                if model_inputs_context:
                    proposal = await research_service._extract_value_proposal(
                        answer_text=assistant_response,
                        user_message=user_message,
                        model_inputs_context=model_inputs_context,
                        hint_field_name=hint_field,
                        hint_model_type=hint_model,
                    )
                    if proposal:
                        widget_type = "proposed_value"
                        widget_data = proposal
        except Exception as e:
            logger.error(f"propose_input_value action failed: {e}", exc_info=True)
            assistant_response = params.get("message", "I wasn't able to research this value right now.")

    elif action == "start_gs_certification":
        import asyncio as _asyncio
        from app.services.gs_cover_letter import GS_CHECKLIST_ITEMS, _get_fallback_field_schema
        from app.services.gs_template_service import GSTemplateService, TEMPLATE_TYPE_COVER_LETTER, TEMPLATE_TYPE_PRELIMINARY_REVIEW
        try:
            template_svc = GSTemplateService(db)
            template = await _asyncio.wait_for(
                template_svc.get_or_fetch_active_template(TEMPLATE_TYPE_COVER_LETTER),
                timeout=30.0,
            )
            section_context = template_svc.get_section_contexts(TEMPLATE_TYPE_COVER_LETTER)
            widget_type = "gs_checklist"
            widget_data = {
                "checklist_items": GS_CHECKLIST_ITEMS,
                "template_version_id": str(template.id),
                "template_version_label": template.version_label,
                "template_status": template.status,
                "field_schema": template.field_schema or [],
                "section_context": section_context,
                "supported_template_types": [TEMPLATE_TYPE_COVER_LETTER, TEMPLATE_TYPE_PRELIMINARY_REVIEW],
            }
        except Exception as e:
            logger.error(f"GS certification tool failed: {e}", exc_info=True)
            section_context = GSTemplateService(db).get_section_contexts(TEMPLATE_TYPE_COVER_LETTER)
            widget_type = "gs_checklist"
            widget_data = {
                "checklist_items": GS_CHECKLIST_ITEMS,
                "template_version_id": None,
                "template_version_label": None,
                "template_status": None,
                "field_schema": _get_fallback_field_schema(),
                "section_context": section_context,
                "supported_template_types": [TEMPLATE_TYPE_COVER_LETTER, TEMPLATE_TYPE_PRELIMINARY_REVIEW],
            }

    return widget_type, widget_data, assistant_response, sources


_LOWERCASE_WORDS = frozenset(
    ["a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet",
     "at", "by", "in", "of", "on", "to", "up", "as", "is", "it"]
)


def _to_title_case(text: str) -> str:
    """Convert a project title to conventional title case."""
    if not text:
        return text
    words = text.split()
    result = []
    for i, word in enumerate(words):
        # Always capitalise first and last word; lowercase minor words in the middle
        if i == 0 or i == len(words) - 1 or word.lower() not in _LOWERCASE_WORDS:
            # Preserve all-caps acronyms (e.g. "LPG", "IFC")
            result.append(word if word.isupper() and len(word) > 1 else word.capitalize())
        else:
            result.append(word.lower())
    return " ".join(result)


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
        initiative.title = _to_title_case(extracted["project_title"])
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
    user: AuthUser = Depends(get_current_user),
):
    """Send a chat message and get assistant response using LLM-driven orchestration."""
    initiative = await require_editor(db, initiative_id, user)

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
    
    # Extract inputs from the user's message first (skip synthetic UI messages)
    if data.content not in _SKIP_EXTRACTION_MESSAGES:
        extracted = await orchestration.extract_inputs_from_message(
            message=data.content,
            initiative=initiative,
        )
        await update_initiative_from_inputs(db, initiative, extracted, orchestration)

    tool_hint = data.tool_hint or None

    # Get the next action from the orchestration LLM
    action_result = await orchestration.get_next_action(
        messages=messages,
        initiative=initiative,
        tool_hint=tool_hint,
    )
    
    logger.info(f"Orchestration chose action: {action_result.action}")

    from app.services.orchestration import OrchestrationService as _OrchestratorRef2
    _model_inputs_ctx2 = _OrchestratorRef2._format_model_inputs_from_messages(messages)

    # Execute the action
    widget_type, widget_data, assistant_response, sources = await execute_action(
        db, initiative, action_result, orchestration, chat_history=messages, tool_hint=tool_hint,
        model_inputs_context=_model_inputs_ctx2,
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

    # Build completion metadata
    sources_list = [s.to_dict() for s in sources] if sources else None
    verified_count = len([s for s in sources if s.source_type.value != "llm_estimate"]) if sources else 0
    completion_meta = {
        "citation_count": verified_count,
        "tiers_used": list({s.source_type.value for s in sources}) if sources else [],
    }
    
    # Save assistant message
    assistant_message = ChatMessage(
        initiative_id=initiative.id,
        role="assistant",
        content=assistant_response,
        widget_type=widget_type,
        widget_data=widget_data,
        sources=sources_list,
        completion_meta=completion_meta,
    )
    db.add(assistant_message)
    initiative.touch()
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
            thinking_lines=assistant_message.thinking_lines,
            completion_meta=assistant_message.completion_meta,
            feedback=assistant_message.feedback,
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
    user: AuthUser = Depends(get_current_user),
):
    """Get chat history for an initiative."""
    initiative = await require_viewer(db, initiative_id, user)

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
                thinking_lines=msg.thinking_lines,
                completion_meta=msg.completion_meta,
                feedback=msg.feedback,
                created_at=msg.created_at,
            )
            for msg in messages
        ],
        stage_status=build_stage_status(initiative),
    )


@router.patch("/initiatives/{initiative_id}/chat/{message_id}/feedback")
async def set_message_feedback(
    initiative_id: UUID,
    message_id: UUID,
    data: MessageFeedbackRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Set or clear like/dislike feedback on a message."""
    await require_editor(db, initiative_id, user)

    msg_result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.id == message_id,
            ChatMessage.initiative_id == initiative_id,
        )
    )
    msg = msg_result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    msg.feedback = data.feedback
    await db.commit()

    return {"message_id": str(message_id), "feedback": data.feedback}


@router.patch("/initiatives/{initiative_id}/chat/{message_id}/widget")
async def update_message_widget(
    initiative_id: UUID,
    message_id: UUID,
    data: MessageWidgetUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Persist updated widget_data on an existing message (e.g. after LCOE/Carbon recalculation)."""
    initiative = await require_editor(db, initiative_id, user)

    msg_result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.id == message_id,
            ChatMessage.initiative_id == initiative_id,
        )
    )
    msg = msg_result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    msg.widget_data = data.widget_data

    from sqlalchemy.orm.attributes import flag_modified
    from datetime import datetime, timezone

    # Bump updated_at so the initiative sorts correctly in history
    initiative.updated_at = datetime.now(timezone.utc)

    # Keep initiative.deliverables in sync for LCOE/Carbon models.
    # Only update when the widget has a real computed result AND non-empty inputs —
    # both are required so we never store a deliverable with missing/corrupt input data.
    lcoe_types = ("lcoe_output", "lcoe_inputs")
    carbon_types = ("carbon_output", "carbon_inputs")
    if msg.widget_type in lcoe_types + carbon_types:
        content = data.widget_data
        has_real_result = bool(content.get("result") and content.get("computable", False))
        has_inputs = bool(content.get("inputs"))
        if has_real_result and has_inputs:
            if msg.widget_type in lcoe_types:
                lcoe_val = content["result"].get("lcoe", 0)
                currency = content["result"].get("currency", "USD")
                initiative.save_deliverable(
                    "lcoe_model",
                    f"LCOE Model ({currency} {lcoe_val:.4f}/kWh)",
                    "lcoe",
                    content,
                )
            elif msg.widget_type in carbon_types:
                net_er = content["result"].get("net_er_tco2e", 0)
                initiative.save_deliverable(
                    "carbon_model",
                    f"Carbon ER Model ({net_er:,.2f} tCO₂e/yr)",
                    "carbon",
                    content,
                )

    await db.commit()

    return {"message_id": str(message_id), "updated": True}


@router.delete("/initiatives/{initiative_id}/chat/truncate", response_model=TruncateChatResponse)
async def truncate_chat(
    initiative_id: UUID,
    data: TruncateChatRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Delete a message and all messages after it (used by the Edit flow)."""
    initiative = await require_editor(db, initiative_id, user)

    # Fetch the target message to get its created_at timestamp
    from uuid import UUID as UUIDType
    try:
        target_id = UUIDType(data.from_message_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid message ID")

    msg_result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.id == target_id,
            ChatMessage.initiative_id == initiative_id,
        )
    )
    target_msg = msg_result.scalar_one_or_none()
    if not target_msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    # Delete the target message and everything after it (by created_at)
    all_msgs_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.initiative_id == initiative_id)
        .order_by(ChatMessage.created_at)
    )
    all_msgs = all_msgs_result.scalars().all()

    to_delete = [m for m in all_msgs if m.created_at >= target_msg.created_at]
    for m in to_delete:
        await db.delete(m)
    await db.commit()

    # Return remaining messages
    remaining_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.initiative_id == initiative_id)
        .order_by(ChatMessage.created_at)
    )
    remaining = remaining_result.scalars().all()

    return TruncateChatResponse(
        deleted_count=len(to_delete),
        messages=[
            ChatMessageResponse(
                id=m.id,
                role=m.role,
                content=m.content,
                widget_type=m.widget_type,
                widget_data=m.widget_data,
                sources=[SourceCitation(**s) for s in m.sources] if m.sources else None,
                thinking_lines=m.thinking_lines,
                completion_meta=m.completion_meta,
                feedback=m.feedback,
                created_at=m.created_at,
            )
            for m in remaining
        ],
    )


@router.post("/initiatives/{initiative_id}/chat/retry/{message_id}", response_model=RetryResponse)
async def retry_assistant_message(
    initiative_id: UUID,
    message_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Delete an assistant message and regenerate it from the same preceding context."""
    initiative = await require_editor(db, initiative_id, user)

    # Fetch the target assistant message
    msg_result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.id == message_id,
            ChatMessage.initiative_id == initiative_id,
        )
    )
    target_msg = msg_result.scalar_one_or_none()
    if not target_msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    if target_msg.role != "assistant":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Can only retry assistant messages")

    # Get full history up to (but not including) the target message
    all_msgs_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.initiative_id == initiative_id)
        .order_by(ChatMessage.created_at)
    )
    all_msgs = list(all_msgs_result.scalars().all())
    history_before = [m for m in all_msgs if m.created_at < target_msg.created_at]

    # Delete the target message and all messages after it
    to_delete = [m for m in all_msgs if m.created_at >= target_msg.created_at]
    for m in to_delete:
        await db.delete(m)
    await db.commit()

    # Re-run orchestration from the same history
    orchestration = OrchestrationService(db)
    action_result = await orchestration.get_next_action(
        messages=history_before,
        initiative=initiative,
    )

    from app.services.orchestration import OrchestrationService as _OrchestratorRef3
    _model_inputs_ctx3 = _OrchestratorRef3._format_model_inputs_from_messages(history_before)

    widget_type, widget_data, assistant_response, sources = await execute_action(
        db, initiative, action_result, orchestration, chat_history=history_before,
        model_inputs_context=_model_inputs_ctx3,
    )

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

    sources_list = [s.to_dict() for s in sources] if sources else None
    verified_count = len([s for s in sources if s.source_type.value != "llm_estimate"]) if sources else 0
    retry_completion_meta = {
        "citation_count": verified_count,
        "tiers_used": list({s.source_type.value for s in sources}) if sources else [],
    }

    new_message = ChatMessage(
        initiative_id=initiative.id,
        role="assistant",
        content=assistant_response,
        widget_type=widget_type,
        widget_data=widget_data,
        sources=sources_list,
        completion_meta=retry_completion_meta,
    )
    db.add(new_message)
    initiative.touch()
    await db.commit()
    await db.refresh(new_message)

    return RetryResponse(
        message=ChatMessageResponse(
            id=new_message.id,
            role=new_message.role,
            content=new_message.content,
            widget_type=new_message.widget_type,
            widget_data=new_message.widget_data,
            sources=source_citations,
            thinking_lines=new_message.thinking_lines,
            completion_meta=new_message.completion_meta,
            feedback=new_message.feedback,
            created_at=new_message.created_at,
        ),
        stage_status=build_stage_status(initiative),
    )


@router.post("/initiatives/{initiative_id}/alignment/confirm", response_model=AlignmentResponse)
async def confirm_alignment(
    initiative_id: UUID,
    data: AlignmentConfirmRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Confirm an alignment, optionally with modifications."""
    initiative = await require_editor(db, initiative_id, user)

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
    
    # If no pending alignments, generate deliverables immediately
    if not pending:
        message = f"Perfect! The {tool_name} outline is confirmed. Generating your deliverables now..."

        # Save a brief confirmation message
        confirm_msg = ChatMessage(
            initiative_id=initiative.id,
            role="assistant",
            content=message,
        )
        db.add(confirm_msg)
        await db.commit()

        # Prepare inputs
        inputs = initiative.tool_inputs or {}
        if initiative.title:
            inputs.setdefault("project_title", initiative.title)
        if initiative.geography:
            inputs.setdefault("geography", initiative.geography)
        if initiative.target_population:
            inputs.setdefault("target_beneficiaries", initiative.target_population)
        if initiative.goal:
            inputs.setdefault("project_goal", initiative.goal)
        if initiative.budget_range:
            inputs.setdefault("budget_range", initiative.budget_range)
        if initiative.timeline:
            inputs.setdefault("timeline", initiative.timeline)

        tool_alignments = initiative.tool_alignments or {}

        WIDGET_TYPES = {"memo": "memo_viewer", "checklist": "checklist_viewer"}
        WIDGET_LABELS = {"memo_viewer": "Investment Memo", "checklist_viewer": "Due Diligence Checklist"}

        for sel_tool_id in (initiative.selected_tools or []):
            sel_tool = registry.get_tool(sel_tool_id)
            if not sel_tool or not sel_tool.requires_alignment:
                continue
            sel_alignment_data = tool_alignments.get(sel_tool_id, {})
            if not sel_alignment_data.get("confirmed"):
                continue

            try:
                alignment_obj = ToolAlignment.from_dict(sel_alignment_data)
                output = await sel_tool.execute(
                    db=db,
                    initiative_id=initiative.id,
                    inputs=inputs,
                    include_corpus=True,
                    alignment=alignment_obj,
                )
                initiative.save_deliverable(
                    sel_tool_id, output.title, output.output_type, output.content,
                )
                w_type = WIDGET_TYPES.get(output.output_type, "document_viewer")
                label = WIDGET_LABELS.get(w_type, sel_tool.definition.name)
                deliverable_msg = ChatMessage(
                    initiative_id=initiative.id,
                    role="assistant",
                    content=f"Here's your **{label}** — review it in the editor and export when ready.",
                    widget_type=w_type,
                    widget_data={"content": output.content},
                )
                db.add(deliverable_msg)
            except Exception as e:
                logger.error(f"Failed to generate {sel_tool_id}: {e}", exc_info=True)
                err_msg = ChatMessage(
                    initiative_id=initiative.id,
                    role="assistant",
                    content=f"I wasn't able to generate the {sel_tool.definition.name} right now. Please try again.",
                )
                db.add(err_msg)

        initiative.stage = InitiativeStage.COMPLETE.value
        await db.commit()
    else:
        # Save assistant message for the next alignment
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
    user: AuthUser = Depends(get_current_user),
):
    """Provide feedback to update an alignment."""
    initiative = await require_editor(db, initiative_id, user)

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
    user: AuthUser = Depends(get_current_user),
):
    """Get the current alignment for a specific tool."""
    initiative = await require_viewer(db, initiative_id, user)

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
