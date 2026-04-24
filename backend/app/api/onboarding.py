"""Chat API endpoints with LLM-driven orchestration."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
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
from app.services import module_service
from app.modules import get_module_registry
from app.api.chat_constants import (
    INITIAL_ONBOARDING_DOCUMENT_PROMPT as _INITIAL_ONBOARDING_DOCUMENT_PROMPT,
    SKIP_EXTRACTION_MESSAGES as _SKIP_EXTRACTION_MESSAGES,
)

router = APIRouter()
logger = logging.getLogger(__name__)

def _build_initial_onboarding_document_response() -> tuple[str, dict, str, list]:
    return (
        "document_request",
        {
            "allow_multiple": True,
            "suggested_types": [],
        },
        _INITIAL_ONBOARDING_DOCUMENT_PROMPT,
        [],
    )


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
    
    user_message_count = sum(1 for m in messages if m.role == "user")
    is_first_user_message = user_message_count == 1

    if is_first_user_message:
        widget_type, widget_data, assistant_response, sources = (
            _build_initial_onboarding_document_response()
        )
    else:
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
            onboarding_mode=True,
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


