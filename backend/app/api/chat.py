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
from sqlalchemy import select

from app.core.database import get_db
from app.core.execution_context import build_context
from app.core.auth import get_current_user, AuthUser, MockUser
from app.core.billing_guard import require_ai_access
from app.core.permissions import get_initiative_with_role
from app.core.llm_client import get_openai_client, record_usage_from_response
from app.config import get_settings
from app.services.chat import ChatService
from app.services import module_service
from app.models.chat import CoreChatSession, CoreChatMessage
from app.models.initiative import Initiative
from app.core.rate_limit import limiter

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()


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


class ChatHistoryMessage(BaseModel):
    role: str
    content: str


class ChatStreamRequest(BaseModel):
    content: str = Field(..., max_length=50000)
    history: list[ChatHistoryMessage] = Field(default=[], max_length=100)
    session_id: Optional[str] = None
    tool_hint: Optional[str] = None
    model_inputs_context: Optional[str] = Field(default=None, max_length=20000)
    initiative_id: Optional[str] = None
    compare_initiative_ids: Optional[list[str]] = None


class TitleRequest(BaseModel):
    message: str


class FeedbackRequest(BaseModel):
    feedback: Optional[str] = None  # "like" | "dislike" | null to clear


async def _get_or_create_session(
    db: AsyncSession,
    user_id: str,
    session_id: Optional[str],
    initiative_id: Optional[uuid.UUID] = None,
) -> CoreChatSession:
    """Return an existing session or create a new one."""
    if session_id:
        try:
            sid = uuid.UUID(session_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid session_id format")
        result = await db.execute(
            select(CoreChatSession).where(
                CoreChatSession.id == sid,
                CoreChatSession.user_id == user_id,
            )
        )
        session = result.scalar_one_or_none()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        if initiative_id and not session.initiative_id:
            session.initiative_id = initiative_id
            await db.flush()
        return session

    session = CoreChatSession(user_id=user_id, initiative_id=initiative_id)
    db.add(session)
    await db.flush()
    return session


@router.get("/chat/sessions")
async def list_sessions(
    initiative_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Return core chat sessions for the current user, most recent first.

    When initiative_id is provided, only sessions scoped to that project are
    returned.  When omitted, all sessions (including unscoped ones) are returned.
    """
    from sqlalchemy import func

    query = (
        select(
            CoreChatSession.id,
            CoreChatSession.title,
            CoreChatSession.created_at,
            CoreChatSession.updated_at,
            CoreChatSession.compare_initiative_ids,
            CoreChatSession.initiative_id,
            func.count(CoreChatMessage.id).label("message_count"),
        )
        .outerjoin(CoreChatMessage, CoreChatMessage.session_id == CoreChatSession.id)
        .where(CoreChatSession.user_id == user.uid)
        .group_by(CoreChatSession.id)
        .order_by(CoreChatSession.updated_at.desc())
        .limit(50)
    )

    if initiative_id:
        try:
            init_uuid = uuid.UUID(initiative_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid initiative_id")
        query = query.where(CoreChatSession.initiative_id == init_uuid)

    result = await db.execute(query)
    rows = result.all()

    return {
        "sessions": [
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


@router.get("/chat/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Return all messages for a core chat session."""
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id")

    session_result = await db.execute(
        select(CoreChatSession).where(
            CoreChatSession.id == sid,
            CoreChatSession.user_id == user.uid,
        )
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    messages_result = await db.execute(
        select(CoreChatMessage)
        .where(CoreChatMessage.session_id == sid)
        .order_by(CoreChatMessage.created_at)
    )
    messages = messages_result.scalars().all()

    return {
        "session_id": str(session.id),
        "title": session.title,
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


@router.delete("/chat/sessions/{session_id}")
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Delete a core chat session and all its messages (CASCADE)."""
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id")

    result = await db.execute(
        select(CoreChatSession).where(
            CoreChatSession.id == sid,
            CoreChatSession.user_id == user.uid,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await db.delete(session)
    await db.commit()
    return {"deleted": True, "session_id": session_id}


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
            # Resolve initiative_id for session scoping.
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

            # Persist session + user message upfront
            session = await _get_or_create_session(
                db, user.uid, data.session_id, initiative_id=resolved_initiative_id,
            )

            user_msg = CoreChatMessage(
                session_id=session.id,
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
                .where(CoreChatMessage.session_id == session.id)
                .where(CoreChatMessage.id != user_msg.id)
                .order_by(CoreChatMessage.created_at)
            )
            prior_msgs = prior_msgs_result.scalars().all()
            history = [{"role": m.role, "content": m.content} for m in prior_msgs]
            ctx = await build_context(db, user, resolved_initiative_id)
            service = ChatService(db, ctx=ctx)

            verified_initiative: Initiative | None = None

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
                    # Persist compare_initiative_ids on the session
                    if not session.compare_initiative_ids:
                        session.compare_initiative_ids = data.compare_initiative_ids
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

            if not compare_contexts:
                _tool_hint = data.tool_hint or ""
                if _tool_hint and data.initiative_id:
                    from app.modules import get_module_registry as _get_registry
                    from app.services.chat import ChatResponse
                    from app.services.module_workflow_service import (
                        ensure_workflow_state,
                        uses_layered_build,
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
                            db, verified_initiative.id, _tool_hint, user.uid, session_id=session.id,
                        )
                        await ensure_workflow_state(db, inst, _workflow_module)
                        await db.commit()

                        if uses_layered_build(_workflow_module):
                            intro = (
                                f"Here's your **{_workflow_module.definition.name}** workspace. "
                                "Review the setup, work through the build stage, and finalize the output when you're ready."
                            )
                            tiers_used = ["workspace_setup"]
                        else:
                            intro = (
                                f"Here's your **{_workflow_module.definition.name}** workspace. "
                                "Review the setup context, refine the build-stage inputs, and continue in the editor."
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
                    generation_task = asyncio.create_task(
                        service.generate_response(
                            user_message=data.content,
                            history=history,
                            on_thinking=on_thinking,
                            tool_hint=data.tool_hint or None,
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

            # Stream response token-by-token
            tokens = [t for t in result.content.split(' ') if t]
            for i, token in enumerate(tokens):
                chunk = {"type": "word", "content": token, "is_last": i == len(tokens) - 1}
                yield f"data: {json.dumps(chunk)}\n\n"
                await asyncio.sleep(0.02)

            # Persist assistant message
            sources_list = [s.to_dict() for s in result.sources]
            assistant_msg = CoreChatMessage(
                session_id=session.id,
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
                "session_id": str(session.id),
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
        .join(CoreChatSession)
        .where(
            CoreChatMessage.id == mid,
            CoreChatSession.user_id == user.uid,
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
        .join(CoreChatSession)
        .where(
            CoreChatMessage.id == mid,
            CoreChatSession.user_id == user.uid,
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


@router.patch("/chat/sessions/{session_id}/title")
async def update_session_title(
    session_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Update the AI-generated title on a session."""
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id")

    result = await db.execute(
        select(CoreChatSession).where(
            CoreChatSession.id == sid,
            CoreChatSession.user_id == user.uid,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.title = data.get("title", "")
    await db.commit()
    return {"session_id": str(session.id), "title": session.title}


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


class SaveSessionMessage(BaseModel):
    role: str
    content: str
    widget_type: Optional[str] = None
    widget_data: Optional[dict] = None
    sources: Optional[list] = None
    completion_meta: Optional[dict] = None


class SaveSessionRequest(BaseModel):
    title: Optional[str] = None
    initiative_id: Optional[str] = None
    messages: list[SaveSessionMessage]


@router.post("/chat/sessions/save")
async def save_session_from_messages(
    data: SaveSessionRequest,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Create a chat session from a list of messages (e.g. document flow)."""
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

    session = CoreChatSession(user_id=user.uid, title=data.title, initiative_id=init_uuid)
    db.add(session)
    await db.flush()

    for msg in data.messages:
        db_msg = CoreChatMessage(
            session_id=session.id,
            role=msg.role,
            content=msg.content,
            widget_type=msg.widget_type,
            widget_data=msg.widget_data,
            sources=msg.sources,
            completion_meta=msg.completion_meta,
        )
        db.add(db_msg)

    await db.commit()
    return {"session_id": str(session.id), "title": session.title}


