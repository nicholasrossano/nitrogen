"""Standalone compliance & program design chat endpoint with SSE streaming."""

import uuid
import json
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from openai import AsyncOpenAI

from app.core.database import get_db
from app.core.auth import get_current_user, MockUser
from app.config import get_settings
from app.services.core_chat import ComplianceChatService
from app.models.core_chat import CoreChatSession, CoreChatMessage
from app.models.initiative import Initiative

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


class ComplianceChatRequest(BaseModel):
    content: str
    history: list[ChatHistoryMessage] = []
    session_id: Optional[str] = None  # UUID of existing session, or null to start a new one
    tool_hint: Optional[str] = None  # Optional tool ID the user explicitly selected
    model_inputs_context: Optional[str] = None  # Current LCOE/Carbon model inputs for context
    initiative_id: Optional[str] = None  # Inject project context when chatting from a project


class TitleRequest(BaseModel):
    message: str


class FeedbackRequest(BaseModel):
    feedback: Optional[str] = None  # "like" | "dislike" | null to clear


async def _get_or_create_session(
    db: AsyncSession,
    user_id: str,
    session_id: Optional[str],
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
        return session

    session = CoreChatSession(user_id=user_id)
    db.add(session)
    await db.flush()
    return session


@router.get("/chat/sessions")
async def list_core_chat_sessions(
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Return all core chat sessions for the current user, most recent first."""
    from sqlalchemy import func

    result = await db.execute(
        select(
            CoreChatSession.id,
            CoreChatSession.title,
            CoreChatSession.created_at,
            CoreChatSession.updated_at,
            func.count(CoreChatMessage.id).label("message_count"),
        )
        .outerjoin(CoreChatMessage, CoreChatMessage.session_id == CoreChatSession.id)
        .where(CoreChatSession.user_id == user.uid)
        .group_by(CoreChatSession.id)
        .order_by(CoreChatSession.updated_at.desc())
        .limit(50)
    )
    rows = result.all()

    return {
        "sessions": [
            {
                "id": str(r.id),
                "title": r.title,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                "message_count": r.message_count,
            }
            for r in rows
            if r.message_count > 0
        ]
    }


@router.get("/chat/sessions/{session_id}/messages")
async def get_core_chat_session_messages(
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
async def delete_core_chat_session(
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
async def compliance_chat_stream(
    data: ComplianceChatRequest,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
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
            # Persist session + user message upfront
            session = await _get_or_create_session(db, user.uid, data.session_id)

            user_msg = CoreChatMessage(
                session_id=session.id,
                role="user",
                content=data.content,
            )
            db.add(user_msg)
            await db.flush()

            thinking_queue: asyncio.Queue[str] = asyncio.Queue()
            thinking_lines: list[str] = []

            async def on_thinking(text: str):
                thinking_lines.append(text)
                event = {"type": "thinking", "text": text}
                await thinking_queue.put(json.dumps(event))

            history = [{"role": m.role, "content": m.content} for m in data.history]
            service = ComplianceChatService(db)

            # Load project context when chatting from a project workspace
            project_context: str | None = None
            if data.initiative_id:
                try:
                    init_uuid = uuid.UUID(data.initiative_id)
                    result = await db.execute(
                        select(Initiative).where(
                            Initiative.id == init_uuid,
                            Initiative.user_id == user.uid,
                        )
                    )
                    initiative = result.scalar_one_or_none()
                    if initiative:
                        project_context = _build_project_context(initiative)
                except (ValueError, Exception) as e:
                    logger.warning(f"Failed to load initiative context: {e}")

            generation_task = asyncio.create_task(
                service.generate_response(
                    user_message=data.content,
                    history=history,
                    on_thinking=on_thinking,
                    tool_hint=data.tool_hint or None,
                    model_inputs_context=data.model_inputs_context or None,
                    project_context=project_context,
                )
            )

            while not generation_task.done():
                try:
                    event_json = await asyncio.wait_for(thinking_queue.get(), timeout=0.1)
                    yield f"data: {event_json}\n\n"
                except asyncio.TimeoutError:
                    continue

            while not thinking_queue.empty():
                event_json = await thinking_queue.get()
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
                # IDs for the frontend to track for feedback / retry
                "session_id": str(session.id),
                "user_message_id": str(user_msg.id),
                "assistant_message_id": str(assistant_msg.id),
            }
            yield f"data: {json.dumps(complete)}\n\n"

        except Exception as e:
            logger.error(f"Compliance chat stream error: {e}", exc_info=True)
            try:
                await db.rollback()
            except Exception:
                pass
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

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
async def set_compliance_message_feedback(
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
    user: MockUser = Depends(get_current_user),
):
    """Generate a brief 3-5 word title for a chat based on the first message."""
    client = AsyncOpenAI(api_key=settings.openai_api_key)
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
        title = (resp.choices[0].message.content or "").strip().strip('"').strip("'")
        return {"title": title or data.message[:40]}
    except Exception as e:
        logger.warning(f"Title generation failed: {e}")
        return {"title": data.message[:40]}
