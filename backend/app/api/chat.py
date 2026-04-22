"""Chat endpoint with SSE streaming."""

import uuid
import json
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select

from app.core.database import get_db
from app.core.execution_context import build_context
from app.core.auth import get_current_user, AuthUser, MockUser
from app.core.billing_guard import require_ai_access
from app.core.permissions import get_initiative_with_role
from app.core.llm_client import get_openai_client, record_usage_from_response
from app.config import get_settings
from app.services.chat import ChatMode, ChatResponse as ServiceChatResponse, ChatService
from app.services import module_service
from app.models.chat import CoreChat, CoreChatMessage
from app.models.initiative import Initiative
from app.models.project_material import ProjectMaterial
from app.core.rate_limit import limiter
from app.schemas.chat import FieldContext

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()

# Synthetic messages sent by UI actions that carry no project detail.
_SKIP_EXTRACTION_MESSAGES = {
    "I've uploaded my documents.",
    "I don't have any documents to upload.",
}


def _log_chat_stream_debug(event: str, **fields) -> None:
    serialized = " ".join(f"{key}={value!r}" for key, value in fields.items())
    logger.info("[chat-stream-debug] %s %s", event, serialized)


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


def _to_title_case(text: str) -> str:
    """Convert extracted titles into consistent title case."""
    if not text:
        return text
    minor_words = {
        "a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet",
        "at", "by", "in", "of", "on", "to", "up", "as", "is", "it",
    }
    words = text.split()
    formatted: list[str] = []
    for idx, word in enumerate(words):
        if idx == 0 or idx == len(words) - 1 or word.lower() not in minor_words:
            formatted.append(word if word.isupper() and len(word) > 1 else word.capitalize())
        else:
            formatted.append(word.lower())
    return " ".join(formatted)


async def _update_initiative_from_inputs(
    db: AsyncSession,
    initiative: Initiative,
    extracted: dict,
) -> bool:
    """Persist extracted initiative context fields when currently unset."""
    if not extracted:
        return False

    updated = False

    if extracted.get("project_title") and not initiative.title:
        initiative.title = _to_title_case(extracted["project_title"])
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
        await db.flush()
        await db.refresh(initiative)

    return updated


async def _execute_project_action(
    *,
    service: ChatService,
    initiative: Initiative,
    action_result,
    chat_history: list,
    tool_hint: str | None,
    model_inputs_context: str | None,
    field_context: dict | None,
    on_thinking,
) -> ServiceChatResponse:
    widget_type, widget_data, assistant_response, sources = await service.execute_project_action(
        initiative=initiative,
        action_result=action_result,
        chat_history=chat_history,
        tool_hint=tool_hint,
        model_inputs_context=model_inputs_context,
        field_context=field_context,
        on_thinking=on_thinking,
    )
    return ServiceChatResponse(
        content=assistant_response,
        sources=sources or [],
        tiers_used=list({s.source_type.value for s in sources}) if sources else [],
        latency_ms=0,
        widget_type=widget_type,
        widget_data=widget_data,
    )


async def _should_trigger_initial_project_onboarding(
    db: AsyncSession,
    *,
    user_id: str,
    initiative: Initiative,
    current_user_message_id: uuid.UUID,
) -> bool:
    """Only show the upload-documents onboarding widget for the first project chat."""
    if getattr(initiative, "project_plan", None) or getattr(initiative, "evidence_ready", False):
        return False

    prior_project_message_count = await db.scalar(
        select(func.count(CoreChatMessage.id))
        .select_from(CoreChatMessage)
        .join(CoreChat, CoreChatMessage.chat_id == CoreChat.id)
        .where(
            CoreChat.user_id == user_id,
            CoreChat.initiative_id == initiative.id,
            CoreChatMessage.id != current_user_message_id,
        )
    )
    if (prior_project_message_count or 0) > 0:
        return False

    uploaded_material_count = await db.scalar(
        select(func.count(ProjectMaterial.id)).where(
            ProjectMaterial.initiative_id == initiative.id,
        )
    )
    return (uploaded_material_count or 0) == 0


async def _build_initial_project_onboarding_response() -> ServiceChatResponse:
    return ServiceChatResponse(
        content="Please upload any relevant project materials, such as feasibility studies, site assessments, or permit applications.",
        sources=[],
        tiers_used=[],
        latency_ms=0,
        widget_type="document_request",
        widget_data={
            "allow_multiple": True,
            "suggested_types": [],
        },
    )


class ChatHistoryMessage(BaseModel):
    role: str
    content: str


class ChatStreamRequest(BaseModel):
    content: str = Field(..., max_length=50000)
    history: list[ChatHistoryMessage] = Field(default=[], max_length=100)
    chat_id: Optional[str] = None
    tool_hint: Optional[str] = None
    field_context: Optional[FieldContext] = None
    model_inputs_context: Optional[str] = Field(default=None, max_length=20000)
    initiative_id: Optional[str] = None
    compare_initiative_ids: Optional[list[str]] = None
    allow_initial_project_onboarding: bool = False


class TitleRequest(BaseModel):
    message: str


class FeedbackRequest(BaseModel):
    feedback: Optional[str] = None  # "like" | "dislike" | null to clear


async def _get_or_create_chat(
    db: AsyncSession,
    user_id: str,
    chat_id: Optional[str],
    initiative_id: Optional[uuid.UUID] = None,
) -> CoreChat:
    """Return an existing chat or create a new one."""
    if chat_id:
        try:
            cid = uuid.UUID(chat_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid chat_id format")
        result = await db.execute(
            select(CoreChat).where(
                CoreChat.id == cid,
                CoreChat.user_id == user_id,
            )
        )
        chat = result.scalar_one_or_none()
        if not chat:
            raise HTTPException(status_code=404, detail="Chat not found")
        if initiative_id and not chat.initiative_id:
            chat.initiative_id = initiative_id
            await db.flush()
        return chat

    chat = CoreChat(user_id=user_id, initiative_id=initiative_id)
    db.add(chat)
    await db.flush()
    return chat


@router.get("/chats")
async def list_chats(
    initiative_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Return core chats for the current user, most recent first.

    When initiative_id is provided, only sessions scoped to that project are
    returned.  When omitted, all sessions (including unscoped ones) are returned.
    """
    from sqlalchemy import func

    query = (
        select(
            CoreChat.id,
            CoreChat.title,
            CoreChat.created_at,
            CoreChat.updated_at,
            CoreChat.compare_initiative_ids,
            CoreChat.initiative_id,
            func.count(CoreChatMessage.id).label("message_count"),
        )
        .outerjoin(CoreChatMessage, CoreChatMessage.chat_id == CoreChat.id)
        .where(CoreChat.user_id == user.uid)
        .group_by(CoreChat.id)
        .order_by(CoreChat.updated_at.desc())
        .limit(50)
    )

    if initiative_id:
        try:
            init_uuid = uuid.UUID(initiative_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid initiative_id")
        query = query.where(CoreChat.initiative_id == init_uuid)

    result = await db.execute(query)
    rows = result.all()

    return {
        "chats": [
            {
                "id": str(r.id),
                "title": r.title,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                "message_count": r.message_count,
                "compare_initiative_ids": r.compare_initiative_ids,
                "initiative_id": str(r.initiative_id) if r.initiative_id else None,
            }
            for r in rows
            if r.message_count > 0
        ]
    }


@router.get("/chats/{chat_id}/messages")
async def get_chat_messages(
    chat_id: str,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Return all messages for a core chat."""
    try:
        cid = uuid.UUID(chat_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid chat_id")

    chat_result = await db.execute(
        select(CoreChat).where(
            CoreChat.id == cid,
            CoreChat.user_id == user.uid,
        )
    )
    chat = chat_result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    messages_result = await db.execute(
        select(CoreChatMessage)
        .where(CoreChatMessage.chat_id == cid)
        .order_by(CoreChatMessage.created_at)
    )
    messages = messages_result.scalars().all()

    return {
        "chat_id": str(chat.id),
        "title": chat.title,
        "messages": [
            {
                "id": str(m.id),
                "role": m.role,
                "content": m.content,
                "sources": m.sources,
                "thinking_lines": m.thinking_lines,
                "completion_meta": m.completion_meta,
                "widget_type": m.widget_type,
                "widget_data": m.widget_data,
                "feedback": m.feedback,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ],
    }


@router.get("/chats/{chat_id}/modules")
async def get_chat_modules(
    chat_id: str,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Return module instances associated with a core chat."""
    from app.models.module_instance import ModuleInstance

    try:
        cid = uuid.UUID(chat_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid chat_id")

    chat_result = await db.execute(
        select(CoreChat).where(
            CoreChat.id == cid,
            CoreChat.user_id == user.uid,
        )
    )
    chat = chat_result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    modules_result = await db.execute(
        select(ModuleInstance)
        .where(ModuleInstance.chat_id == cid)
        .order_by(ModuleInstance.started_at.asc())
    )
    modules = modules_result.scalars().all()

    return {
        "modules": [
            {
                "instance_id": str(module.id),
                "module_id": module.module_id,
                "title": module.title,
                "status": module.status,
                "started_at": module.started_at.isoformat() if module.started_at else None,
            }
            for module in modules
        ]
    }


@router.post("/chats/{chat_id}/modules/{instance_id}")
async def associate_chat_module(
    chat_id: str,
    instance_id: str,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Associate an existing module instance with a core chat."""
    from app.models.module_instance import ModuleInstance

    try:
        cid = uuid.UUID(chat_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid chat_id")

    try:
        iid = uuid.UUID(instance_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid instance_id")

    chat_result = await db.execute(
        select(CoreChat).where(
            CoreChat.id == cid,
            CoreChat.user_id == user.uid,
        )
    )
    chat = chat_result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    instance = await db.get(ModuleInstance, iid)
    if instance is None:
        raise HTTPException(status_code=404, detail="Module instance not found")

    if chat.initiative_id and instance.initiative_id != chat.initiative_id:
        raise HTTPException(
            status_code=400,
            detail="Module instance belongs to a different initiative",
        )

    instance.chat_id = chat.id
    await db.commit()

    return {
        "instance_id": str(instance.id),
        "chat_id": str(chat.id),
        "module_id": instance.module_id,
    }


@router.delete("/chats/{chat_id}")
async def delete_chat(
    chat_id: str,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Delete a core chat and all its messages (CASCADE)."""
    try:
        cid = uuid.UUID(chat_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid chat_id")

    result = await db.execute(
        select(CoreChat).where(
            CoreChat.id == cid,
            CoreChat.user_id == user.uid,
        )
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    await db.delete(chat)
    await db.commit()
    return {"deleted": True, "chat_id": chat_id}


@router.post("/chat/stream")
@limiter.limit("20/minute")
async def chat_stream(
    request: Request,
    data: ChatStreamRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_ai_access),
):
    """
    Standalone compliance chat with SSE streaming.

    Event types:
      - thinking: natural-language progress text
      - word: response tokens
      - complete: final payload with citations, metadata, and DB IDs for persistence
    """

    async def generate():
        try:
            # Resolve initiative_id for chat scoping.
            resolved_initiative_id: uuid.UUID | None = None
            if data.initiative_id:
                try:
                    resolved_initiative, _ = await get_initiative_with_role(
                        db, data.initiative_id, user
                    )
                    resolved_initiative_id = resolved_initiative.id
                except HTTPException:
                    # Keep session unscoped; access is enforced below where needed.
                    pass

            # Persist chat + user message upfront
            chat = await _get_or_create_chat(
                db, user.uid, data.chat_id, initiative_id=resolved_initiative_id,
            )

            user_msg = CoreChatMessage(
                chat_id=chat.id,
                role="user",
                content=data.content,
            )
            db.add(user_msg)
            await db.flush()

            event_queue: asyncio.Queue[str] = asyncio.Queue()
            thinking_lines: list[str] = []

            async def on_thinking(text: str):
                thinking_lines.append(text)
                event = {"type": "thinking", "text": text}
                await event_queue.put(json.dumps(event))

            async def on_research_step(step_id: str, label: str, step_status: str):
                event = {"type": "research_step", "id": step_id, "label": label, "status": step_status}
                await event_queue.put(json.dumps(event))

            # Reconstruct history server-side from stored messages
            prior_msgs_result = await db.execute(
                select(CoreChatMessage)
                .where(CoreChatMessage.chat_id == chat.id)
                .where(CoreChatMessage.id != user_msg.id)
                .order_by(CoreChatMessage.created_at)
            )
            prior_msgs = prior_msgs_result.scalars().all()
            conversation_msgs = [*prior_msgs, user_msg]
            history = [{"role": m.role, "content": m.content} for m in prior_msgs]
            ctx = await build_context(db, user, resolved_initiative_id)
            ctx.chat_id = chat.id

            verified_initiative: Initiative | None = None
            field_context = data.field_context.model_dump() if data.field_context else None

            _log_chat_stream_debug(
                "request",
                chat_id=str(chat.id),
                initiative_id=data.initiative_id,
                compare=bool(data.compare_initiative_ids),
                tool_hint=data.tool_hint,
                field_name=(field_context or {}).get("field_name"),
                has_field_context=bool(field_context),
                has_model_inputs_context=bool(data.model_inputs_context),
                allow_initial_project_onboarding=data.allow_initial_project_onboarding,
            )

            # --- Compare mode ---
            compare_contexts: list[dict] | None = None
            if data.compare_initiative_ids and len(data.compare_initiative_ids) == 2:
                compare_contexts = []
                for cid in data.compare_initiative_ids:
                    try:
                        initiative, _role = await get_initiative_with_role(db, cid, user)
                        compare_contexts.append({
                            "initiative_id": str(initiative.id),
                            "project_context": _build_project_context(initiative),
                            "title": initiative.title or "Untitled Project",
                        })
                    except (HTTPException, Exception) as e:
                        logger.warning(f"Failed to load compare initiative {cid}: {e}")
                        compare_contexts = None
                        break

                if compare_contexts:
                    service = ChatService(db, ctx=ctx)
                    # Persist compare_initiative_ids on the chat
                    if not chat.compare_initiative_ids:
                        chat.compare_initiative_ids = data.compare_initiative_ids
                        await db.flush()

                    generation_task = asyncio.create_task(
                        service.generate_response(
                            user_message=data.content,
                            history=history,
                            on_thinking=on_thinking,
                            on_research_step=on_research_step,
                            compare_contexts=compare_contexts,
                        )
                    )
                else:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'Failed to load one or both projects for comparison.'})}\n\n"
                    return

            # --- Single project / normal mode ---
            if not compare_contexts:
                project_context: str | None = None
                if data.initiative_id:
                    try:
                        verified_initiative, _role = await get_initiative_with_role(
                            db, data.initiative_id, user
                        )
                        project_context = _build_project_context(verified_initiative)
                    except HTTPException:
                        yield f"data: {json.dumps({'type': 'error', 'message': 'You do not have access to this project.'})}\n\n"
                        return

                service = ChatService(
                    db,
                    ctx=ctx,
                    mode=ChatMode.PROJECT if verified_initiative else ChatMode.STANDALONE,
                )

                should_use_initial_project_onboarding = False
                if verified_initiative:
                    is_first_turn_in_thread = len(data.history) == 0
                    should_force_scripted_onboarding = (
                        data.allow_initial_project_onboarding
                        and is_first_turn_in_thread
                        and not field_context
                        and not data.tool_hint
                        and not verified_initiative.project_plan
                        and not verified_initiative.evidence_ready
                    )
                    should_use_initial_project_onboarding = await _should_trigger_initial_project_onboarding(
                        db,
                        user_id=user.uid,
                        initiative=verified_initiative,
                        current_user_message_id=user_msg.id,
                    )
                    should_use_initial_project_onboarding = (
                        should_force_scripted_onboarding
                        or (
                            should_use_initial_project_onboarding
                            and data.allow_initial_project_onboarding
                            and not field_context
                            and not data.tool_hint
                        )
                    )
                    # Extract structured fields (type, geography, title) from the user's
                    # message whenever they're missing — including the first message even when
                    # we're returning a scripted response.  Skip synthetic UI messages that
                    # carry no project detail (e.g. "I've uploaded my documents.").
                    should_extract = (
                        data.content not in _SKIP_EXTRACTION_MESSAGES
                        and (
                            not verified_initiative.project_type
                            or not verified_initiative.geography
                            or not verified_initiative.title
                        )
                    )
                    if should_extract:
                        extracted = await service.extract_inputs_from_message(
                            message=data.content,
                            initiative=verified_initiative,
                        )
                        updated = await _update_initiative_from_inputs(
                            db,
                            verified_initiative,
                            extracted,
                        )
                        if updated:
                            project_context = _build_project_context(verified_initiative)

            if not compare_contexts:
                _tool_hint = data.tool_hint or ""
                if _tool_hint and data.initiative_id:
                    from app.modules import get_module_registry as _get_registry
                    from app.services.chat import ChatResponse
                    from app.services.module_workflow_service import (
                        ensure_workflow_state,
                        is_assessment_module,
                        uses_workspace_flow,
                    )

                    _registry = _get_registry()
                    _workflow_module = _registry.get_module(_tool_hint)
                else:
                    _workflow_module = None

                if _workflow_module and data.initiative_id and uses_workspace_flow(_workflow_module):
                    if not verified_initiative:
                        yield f"data: {json.dumps({'type': 'error', 'message': 'Project access required for this module.'})}\n\n"
                        return

                    async def _open_workflow_workspace():
                        if on_thinking:
                            await on_thinking(f"Opening {_workflow_module.definition.name} workspace...")
                        inst = await module_service.get_or_create_instance(
                            db, verified_initiative.id, _tool_hint, user.uid, chat_id=chat.id,
                        )
                        await ensure_workflow_state(db, inst, _workflow_module)
                        await db.commit()

                        if is_assessment_module(_workflow_module):
                            intro = (
                                f"Here's your **{_workflow_module.definition.name}** workspace. "
                                "Work through each stage and confirm when you're ready to advance."
                            )
                            tiers_used = ["workspace_setup"]
                        else:
                            intro = (
                                f"Here's your **{_workflow_module.definition.name}** workspace. "
                                "Review the inputs, confirm them, and the results will auto-compute."
                            )
                            tiers_used = ["workspace_build"]

                        return ChatResponse(
                            content=intro,
                            sources=[], tiers_used=tiers_used, latency_ms=0,
                            widget_type="module_workspace",
                            widget_data={
                                "instance_id": str(inst.id),
                                "module_id": _tool_hint,
                            },
                        )

                    generation_task = asyncio.create_task(_open_workflow_workspace())
                else:
                    if verified_initiative:
                        if should_use_initial_project_onboarding:
                            generation_task = asyncio.create_task(
                                _build_initial_project_onboarding_response()
                            )
                            while not generation_task.done():
                                try:
                                    event_json = await asyncio.wait_for(event_queue.get(), timeout=0.1)
                                    yield f"data: {event_json}\n\n"
                                except asyncio.TimeoutError:
                                    continue

                            while not event_queue.empty():
                                event_json = await event_queue.get()
                                yield f"data: {event_json}\n\n"

                            result = generation_task.result()
                            _log_chat_stream_debug(
                                "response",
                                chat_id=str(chat.id),
                                initiative_id=data.initiative_id,
                                widget_type=result.widget_type,
                                has_widget_data=bool(result.widget_data),
                                citation_count=0,
                            )

                            tokens = [t for t in result.content.split(' ') if t]
                            for i, token in enumerate(tokens):
                                chunk = {"type": "word", "content": token, "is_last": i == len(tokens) - 1}
                                yield f"data: {json.dumps(chunk)}\n\n"
                                await asyncio.sleep(0.02)

                            sources_list = []
                            assistant_msg = CoreChatMessage(
                                chat_id=chat.id,
                                role="assistant",
                                content=result.content,
                                sources=sources_list,
                                thinking_lines=thinking_lines,
                                completion_meta={
                                    "latency_ms": result.latency_ms,
                                    "citation_count": 0,
                                    "tiers_used": result.tiers_used,
                                },
                                widget_type=result.widget_type,
                                widget_data=result.widget_data,
                            )
                            db.add(assistant_msg)
                            await db.commit()

                            complete = {
                                "type": "complete",
                                "content": result.content,
                                "sources": sources_list,
                                "tiers_used": result.tiers_used,
                                "citation_count": 0,
                                "latency_ms": result.latency_ms,
                                "widget_type": result.widget_type,
                                "widget_data": result.widget_data,
                                "thinking_lines": thinking_lines,
                                "chat_id": str(chat.id),
                                "user_message_id": str(user_msg.id),
                                "assistant_message_id": str(assistant_msg.id),
                            }
                            yield f"data: {json.dumps(complete)}\n\n"
                            return

                        # Synthetic transition messages ("I've uploaded my documents.",
                        # "I don't have any documents.") are known onboarding pivot points —
                        # bypass orchestration LLM and go directly to plan generation.
                        _effective_tool_hint = data.tool_hint or None
                        if (
                            data.content in _SKIP_EXTRACTION_MESSAGES
                            and data.allow_initial_project_onboarding
                            and not field_context
                        ):
                            _effective_tool_hint = "generate_project_plan"

                        action_result = await service.get_next_action(
                            messages=conversation_msgs,
                            initiative=verified_initiative,
                            tool_hint=_effective_tool_hint,
                            field_context=field_context,
                            onboarding_mode=bool(data.allow_initial_project_onboarding),
                        )
                        _log_chat_stream_debug(
                            "project-action",
                            chat_id=str(chat.id),
                            action=action_result.action,
                            field_name=(field_context or {}).get("field_name"),
                            has_model_inputs_context=bool(data.model_inputs_context),
                        )

                        if action_result.action == "generate_project_plan":
                            await on_thinking("Generating your project plan...")
                        elif action_result.action == "run_lcoe_tool":
                            await on_thinking("Building your LCOE model...")
                        elif action_result.action == "run_carbon_tool":
                            await on_thinking("Building your carbon emissions model...")
                        elif action_result.action == "propose_input_value":
                            await on_thinking("Researching a value for this input...")

                        model_inputs_context = (
                            data.model_inputs_context
                            or ChatService._format_model_inputs_from_messages(conversation_msgs, field_context)
                        )
                        generation_task = asyncio.create_task(
                            _execute_project_action(
                                service=service,
                                initiative=verified_initiative,
                                action_result=action_result,
                                chat_history=conversation_msgs,
                                tool_hint=data.tool_hint or None,
                                model_inputs_context=model_inputs_context,
                                field_context=field_context,
                                on_thinking=on_thinking,
                            )
                        )
                    else:
                        generation_task = asyncio.create_task(
                            service.generate_response(
                                user_message=data.content,
                                history=history,
                                on_thinking=on_thinking,
                                tool_hint=data.tool_hint or None,
                                field_context=field_context,
                                model_inputs_context=data.model_inputs_context or None,
                                project_context=project_context,
                                on_research_step=on_research_step,
                                initiative_id=data.initiative_id if verified_initiative else None,
                            )
                        )

            while not generation_task.done():
                try:
                    event_json = await asyncio.wait_for(event_queue.get(), timeout=0.1)
                    yield f"data: {event_json}\n\n"
                except asyncio.TimeoutError:
                    continue

            while not event_queue.empty():
                event_json = await event_queue.get()
                yield f"data: {event_json}\n\n"

            result = generation_task.result()
            _log_chat_stream_debug(
                "response",
                chat_id=str(chat.id),
                initiative_id=data.initiative_id,
                widget_type=result.widget_type,
                has_widget_data=bool(result.widget_data),
                citation_count=len([s for s in result.sources if s.source_type.value != "llm_estimate"]),
            )

            # Stream response token-by-token
            tokens = [t for t in result.content.split(' ') if t]
            for i, token in enumerate(tokens):
                chunk = {"type": "word", "content": token, "is_last": i == len(tokens) - 1}
                yield f"data: {json.dumps(chunk)}\n\n"
                await asyncio.sleep(0.02)

            # Persist assistant message
            sources_list = [s.to_dict() for s in result.sources]
            assistant_msg = CoreChatMessage(
                chat_id=chat.id,
                role="assistant",
                content=result.content,
                sources=sources_list,
                thinking_lines=thinking_lines,
                completion_meta={
                    "latency_ms": result.latency_ms,
                    "citation_count": len([s for s in result.sources if s.source_type.value != "llm_estimate"]),
                    "tiers_used": result.tiers_used,
                },
                widget_type=result.widget_type,
                widget_data=result.widget_data,
            )
            db.add(assistant_msg)

            await db.commit()

            complete = {
                "type": "complete",
                "content": result.content,
                "sources": sources_list,
                "tiers_used": result.tiers_used,
                "citation_count": len([s for s in result.sources if s.source_type.value != "llm_estimate"]),
                "latency_ms": result.latency_ms,
                "widget_type": result.widget_type,
                "widget_data": result.widget_data,
                "thinking_lines": thinking_lines,
                # IDs for the frontend to track for feedback / retry
                "chat_id": str(chat.id),
                "user_message_id": str(user_msg.id),
                "assistant_message_id": str(assistant_msg.id),
            }
            yield f"data: {json.dumps(complete)}\n\n"

        except Exception as e:
            logger.error(f"Chat stream error: {e}", exc_info=True)
            try:
                await db.rollback()
            except Exception:
                pass
            yield f"data: {json.dumps({'type': 'error', 'message': 'An unexpected error occurred. Please try again.'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.patch("/chat/messages/{message_id}/feedback")
async def set_message_feedback(
    message_id: str,
    data: FeedbackRequest,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Persist like / dislike feedback on a compliance chat message."""
    try:
        mid = uuid.UUID(message_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid message_id")

    result = await db.execute(
        select(CoreChatMessage)
        .join(CoreChat)
        .where(
            CoreChatMessage.id == mid,
            CoreChat.user_id == user.uid,
        )
    )
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    if data.feedback not in (None, "like", "dislike"):
        raise HTTPException(status_code=422, detail="feedback must be 'like', 'dislike', or null")

    msg.feedback = data.feedback
    await db.commit()
    return {"message_id": str(msg.id), "feedback": msg.feedback}


class WidgetUpdateRequest(BaseModel):
    widget_data: dict


@router.patch("/chat/messages/{message_id}/widget")
async def update_message_widget(
    message_id: str,
    data: WidgetUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Persist updated widget_data on a core chat message."""
    try:
        mid = uuid.UUID(message_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid message_id")

    result = await db.execute(
        select(CoreChatMessage)
        .join(CoreChat)
        .where(
            CoreChatMessage.id == mid,
            CoreChat.user_id == user.uid,
        )
    )
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    msg.widget_data = data.widget_data

    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(msg, "widget_data")

    await db.commit()

    return {"message_id": str(msg.id), "updated": True}


@router.patch("/chats/{chat_id}/title")
async def update_chat_title(
    chat_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Update the AI-generated title on a chat."""
    try:
        cid = uuid.UUID(chat_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid chat_id")

    result = await db.execute(
        select(CoreChat).where(
            CoreChat.id == cid,
            CoreChat.user_id == user.uid,
        )
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    chat.title = data.get("title", "")
    await db.commit()
    return {"chat_id": str(chat.id), "title": chat.title}


@router.post("/chat/title")
async def generate_chat_title(
    data: TitleRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_ai_access),
):
    """Generate a brief 3-5 word title for a chat based on the first message."""
    client, is_byok = await get_openai_client(user.uid, db)
    try:
        resp = await client.chat.completions.create(
            model=settings.openai_orchestration_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Generate a concise 3-5 word title for a chat conversation based on "
                        "the user's first message. The title should capture the core topic. "
                        "Return ONLY the title — no quotes, no punctuation at the end, no explanation."
                    ),
                },
                {"role": "user", "content": data.message},
            ],
            temperature=0,
            max_tokens=20,
        )
        await record_usage_from_response(user.uid, settings.openai_orchestration_model, resp, db, is_byok=is_byok)
        title = (resp.choices[0].message.content or "").strip().strip('"').strip("'")
        return {"title": title or data.message[:40]}
    except Exception as e:
        logger.warning(f"Title generation failed: {e}")
        return {"title": data.message[:40]}


class SaveChatMessage(BaseModel):
    role: str
    content: str
    widget_type: Optional[str] = None
    widget_data: Optional[dict] = None
    sources: Optional[list] = None
    completion_meta: Optional[dict] = None


class SaveChatRequest(BaseModel):
    title: Optional[str] = None
    initiative_id: Optional[str] = None
    messages: list[SaveChatMessage]


@router.post("/chats/save")
async def save_chat_from_messages(
    data: SaveChatRequest,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Create a chat from a list of messages (e.g. document flow)."""
    if not data.messages:
        raise HTTPException(status_code=400, detail="No messages provided")

    init_uuid: uuid.UUID | None = None
    if data.initiative_id:
        try:
            init_uuid = uuid.UUID(data.initiative_id)
            await get_initiative_with_role(db, init_uuid, user)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid initiative_id")
        except HTTPException:
            raise

    chat = CoreChat(user_id=user.uid, title=data.title, initiative_id=init_uuid)
    db.add(chat)
    await db.flush()

    for msg in data.messages:
        db_msg = CoreChatMessage(
            chat_id=chat.id,
            role=msg.role,
            content=msg.content,
            widget_type=msg.widget_type,
            widget_data=msg.widget_data,
            sources=msg.sources,
            completion_meta=msg.completion_meta,
        )
        db.add(db_msg)

    await db.commit()
    return {"chat_id": str(chat.id), "title": chat.title}


