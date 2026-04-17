"""Chat API endpoints with LLM-driven orchestration."""

import asyncio
import json
import logging
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, AuthUser
from app.core.billing_guard import require_ai_access
from app.core.database import get_db
from app.core.execution_context import build_context
from app.core.permissions import require_editor, require_viewer
from app.models.onboarding import ChatMessage
from app.models.initiative import Initiative
from app.schemas.chat import (
    ChatMessageCreate,
    ChatMessageResponse,
    ChatResponse,
    ChatHistoryResponse,
    StageStatus,
    SourceCitation,
    TruncateChatRequest,
    TruncateChatResponse,
    MessageFeedbackRequest,
    MessageWidgetUpdateRequest,
)
from app.services.chat import ChatService, ChatMode
from app.services.chat_agent import ChatAgentService
from app.plans.registry import get_plan_registry
from app.services import module_service
from app.modules import get_module_registry

router = APIRouter()
logger = logging.getLogger(__name__)

# Synthetic messages sent automatically by the UI that carry no real project info.
# Skipping input extraction for these prevents the LLM from inferring junk titles
# like "Document Upload" when initiative.title is still None.
_SKIP_EXTRACTION_MESSAGES = {
    "I've uploaded my documents.",
    "I don't have any documents to upload.",
}


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
    initiative_id: str,
    data: ChatMessageCreate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_ai_access),
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
                .where(ChatMessage.initiative_id == initiative.id)
                .order_by(ChatMessage.created_at)
            )
            messages = list(history_result.scalars().all())

            ctx = await build_context(db, user, initiative.id)
            chat_service = ChatService(
                db,
                mode=ChatMode.PROJECT,
                ctx=ctx,
            )

            # Detect first user message (only the one we just saved exists)
            user_message_count = sum(1 for m in messages if m.role == "user")
            is_first_user_message = user_message_count == 1

            extraction_task = None
            if data.content not in _SKIP_EXTRACTION_MESSAGES:
                if is_first_user_message:
                    # For the first message, kick off extraction concurrently so the
                    # scripted response can stream immediately without waiting ~3s for LLM.
                    extraction_task = asyncio.create_task(
                        chat_service.extract_inputs_from_message(
                            message=data.content,
                            initiative=initiative,
                        )
                    )
                else:
                    extracted = await chat_service.extract_inputs_from_message(
                        message=data.content,
                        initiative=initiative,
                    )
                    await update_initiative_from_inputs(db, initiative, extracted)

            tool_hint = data.tool_hint or None
            action_result = await chat_service.get_next_action(
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

            _model_inputs_ctx = ChatService._format_model_inputs_from_messages(messages)

            generation_task = asyncio.create_task(
                chat_service.execute_project_action(
                    initiative=initiative,
                    action_result=action_result,
                    chat_history=messages,
                    tool_hint=tool_hint,
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

            # For first-message fast-path: await the background extraction task now
            # (after the client has already received the complete event).
            if extraction_task is not None:
                try:
                    extracted = await asyncio.wait_for(extraction_task, timeout=20.0)
                    await update_initiative_from_inputs(db, initiative, extracted)
                except asyncio.TimeoutError:
                    logger.warning("First-message input extraction timed out")
                except Exception as exc:
                    logger.warning(f"First-message input extraction failed: {exc}")

        except Exception as e:
            logger.error(f"Stream error: {e}", exc_info=True)
            if extraction_task is not None and not extraction_task.done():
                extraction_task.cancel()
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
    """DEPRECATED — use ChatService._build_project_context instead."""
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
    orchestration,
    chat_history: list | None = None,
    tool_hint: str | None = None,
    model_inputs_context: str | None = None,
    on_thinking: Optional[Callable] = None,
    user_id: str | None = None,
) -> tuple[str | None, dict | None, str, list]:
    """DEPRECATED — use ChatService.execute_project_action instead."""
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
            research_service = ChatService(db, ctx=orchestration._chat.ctx)
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
        plan_handler = get_plan_registry().default_handler(db, user_id)
        try:
            structure = await plan_handler.propose_structure(initiative=initiative, chat_history=chat_history)
            widget_type = plan_handler.definition.structure_widget_type
            widget_data = plan_handler.build_structure_widget_data(structure)
        except Exception as e:
            logger.error(f"Category proposal failed: {e}", exc_info=True)
            assistant_response = "I wasn't able to analyze the project right now. Could you provide a bit more detail so I can try again?"
            widget_type = None
            widget_data = None

    elif action == "update_project_plan":
        plan_handler = get_plan_registry().default_handler(db, user_id)
        existing_plan = initiative.project_plan
        user_request = params.get("user_request", "")
        try:
            plan_data = await plan_handler.generate_plan(
                initiative=initiative,
                existing_plan=existing_plan,
                user_request=user_request,
            )
            initiative.project_plan = plan_data
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(initiative, "project_plan")
            await db.commit()
            await db.refresh(initiative)
            widget_type = plan_handler.definition.summary_widget_type
            widget_data = plan_handler.build_summary_widget_data(plan_data)
        except Exception as e:
            logger.error(f"Project plan update failed: {e}", exc_info=True)
            assistant_response = "I wasn't able to update the project plan right now. Please try again."
            widget_type = None
            widget_data = None

    elif action == "run_lcoe_tool":
        from app.modules.lcoe_module import LCOETool
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

                await module_service.save_deliverable(
                    db, initiative.id, "lcoe_model",
                    f"LCOE Model ({currency} {lcoe_val:.4f}/kWh)", "lcoe", content,
                    user_id=user_id or initiative.user_id,
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
        from app.modules.carbon_module import CarbonTool
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

                await module_service.save_deliverable(
                    db, initiative.id, "carbon_model",
                    f"Carbon ER Model ({net_er:,.2f} tCO₂e/yr)", "carbon", content,
                    user_id=user_id or initiative.user_id,
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
            research_service = ChatService(db, ctx=orchestration._chat.ctx)
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

    # Generic deliverable persistence for tools that produce output via the
    # research pipeline (e.g. solar).  LCOE/carbon have dedicated handlers
    # above that already call save_deliverable, so skip those here.
    _ALREADY_SAVED = {"lcoe_output", "lcoe_inputs", "carbon_output", "carbon_inputs"}
    _WIDGET_TYPE_TO_TOOL_ID: dict[str, str] = {
        "solar_output": "solar_estimate",
        "solar_inputs": "solar_estimate",
    }
    if (
        widget_type
        and widget_type not in _ALREADY_SAVED
        and widget_data
        and isinstance(widget_data, dict)
    ):
        from app.modules.registry import get_module_registry
        _registry = get_module_registry()
        _tool_id = _WIDGET_TYPE_TO_TOOL_ID.get(widget_type, "")
        _tool = _registry.get_module(_tool_id)
        if _tool and _tool.is_exportable(widget_data):
            title = _tool.definition.name
            if widget_type == "solar_output":
                annual = (widget_data.get("result") or {}).get("annual_kwh")
                if annual:
                    title = f"Solar Estimate ({annual:,.0f} kWh/yr)"
            await module_service.save_deliverable(
                db, initiative.id, _tool_id,
                title, _tool.definition.output_type, widget_data,
                user_id=user_id or initiative.user_id,
            )

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
    initiative_id: str,
    data: ChatMessageCreate,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_ai_access),
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
        .where(ChatMessage.initiative_id == initiative.id)
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
    
    ctx = await build_context(db, user, initiative.id)
    chat_service = ChatService(
        db,
        mode=ChatMode.PROJECT,
        ctx=ctx,
    )
    
    if data.content not in _SKIP_EXTRACTION_MESSAGES:
        extracted = await chat_service.extract_inputs_from_message(
            message=data.content,
            initiative=initiative,
        )
        await update_initiative_from_inputs(db, initiative, extracted)

    tool_hint = data.tool_hint or None
    field_context = data.field_context.model_dump() if data.field_context else None

    action_result = await chat_service.get_next_action(
        messages=messages,
        initiative=initiative,
        tool_hint=tool_hint,
        field_context=field_context,
    )
    
    logger.info(f"Orchestration chose action: {action_result.action}")

    _model_inputs_ctx2 = ChatService._format_model_inputs_from_messages(messages, field_context)

    widget_type, widget_data, assistant_response, sources = await chat_service.execute_project_action(
        initiative=initiative,
        action_result=action_result,
        chat_history=messages,
        tool_hint=tool_hint,
        model_inputs_context=_model_inputs_ctx2,
        field_context=field_context,
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
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Get chat history for an initiative."""
    initiative = await require_viewer(db, initiative_id, user)

    # Get messages
    messages_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.initiative_id == initiative.id)
        .order_by(ChatMessage.created_at)
    )
    messages = messages_result.scalars().all()
    
    # Rehydrate tool_checklist widget_data with current tool definitions
    registry = get_module_registry()
    tools_by_id = {t.definition.id: t.definition for t in registry.get_all_modules()}
    
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
            initiative_id=initiative.id,
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
    initiative_id: str,
    message_id: str,
    data: MessageFeedbackRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Set or clear like/dislike feedback on a message."""
    initiative = await require_editor(db, initiative_id, user)

    msg_result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.id == message_id,
            ChatMessage.initiative_id == initiative.id,
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
    initiative_id: str,
    message_id: str,
    data: MessageWidgetUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Persist updated widget_data on an existing message (e.g. after LCOE/Carbon recalculation)."""
    initiative = await require_editor(db, initiative_id, user)

    msg_result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.id == message_id,
            ChatMessage.initiative_id == initiative.id,
        )
    )
    msg = msg_result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    msg.widget_data = data.widget_data

    from datetime import datetime, timezone

    # Bump updated_at so the initiative sorts correctly in history
    initiative.updated_at = datetime.now(timezone.utc)

    # Keep initiative.deliverables in sync when model widgets are recalculated.
    _WIDGET_TO_TOOL: dict[str, str] = {
        "lcoe_output": "lcoe_model",
        "lcoe_inputs": "lcoe_model",
        "carbon_output": "carbon_model",
        "carbon_inputs": "carbon_model",
        "solar_output": "solar_estimate",
        "solar_inputs": "solar_estimate",
    }
    _tool_id_for_widget = _WIDGET_TO_TOOL.get(msg.widget_type or "")
    if _tool_id_for_widget:
        from app.modules.registry import get_module_registry
        _tool = get_module_registry().get_module(_tool_id_for_widget)
        content = data.widget_data
        if _tool and _tool.is_exportable(content):
            result = content.get("result") or {}
            if _tool_id_for_widget == "lcoe_model":
                lcoe_val = result.get("lcoe", 0)
                currency = result.get("currency", "USD")
                title = f"LCOE Model ({currency} {lcoe_val:.4f}/kWh)"
            elif _tool_id_for_widget == "carbon_model":
                net_er = result.get("net_er_tco2e", 0)
                title = f"Carbon ER Model ({net_er:,.2f} tCO\u2082e/yr)"
            elif _tool_id_for_widget == "solar_estimate":
                annual = result.get("annual_kwh", 0)
                title = f"Solar Estimate ({annual:,.0f} kWh/yr)"
            else:
                title = _tool.definition.name
            await module_service.save_deliverable(
                db, initiative.id, _tool_id_for_widget,
                title, _tool.definition.output_type, content,
                user_id=user.uid,
            )

    await db.commit()

    return {"message_id": str(message_id), "updated": True}


@router.delete("/initiatives/{initiative_id}/chat/truncate", response_model=TruncateChatResponse)
async def truncate_chat(
    initiative_id: str,
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
            ChatMessage.initiative_id == initiative.id,
        )
    )
    target_msg = msg_result.scalar_one_or_none()
    if not target_msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    # Delete the target message and everything after it (by created_at)
    all_msgs_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.initiative_id == initiative.id)
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
        .where(ChatMessage.initiative_id == initiative.id)
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


