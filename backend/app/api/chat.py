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
from app.core.auth import get_current_user, AuthUser, MockUser
from app.core.billing_guard import require_ai_access
from app.core.permissions import get_initiative_with_role
from app.core.llm_client import get_openai_client, record_usage_from_response
from app.config import get_settings
from app.services.chat import ChatService
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
            # Resolve initiative_id for session scoping
            resolved_initiative_id: uuid.UUID | None = None
            if data.initiative_id:
                try:
                    resolved_initiative_id = uuid.UUID(data.initiative_id)
                except ValueError:
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
            service = ChatService(db)

            # --- Compare mode ---
            compare_contexts: list[dict] | None = None
            if data.compare_initiative_ids and len(data.compare_initiative_ids) == 2:
                compare_contexts = []
                for cid in data.compare_initiative_ids:
                    try:
                        init_uuid = uuid.UUID(cid)
                        initiative, _role = await get_initiative_with_role(db, init_uuid, user)
                        compare_contexts.append({
                            "initiative_id": cid,
                            "project_context": _build_project_context(initiative),
                            "title": initiative.title or "Untitled Project",
                        })
                    except (ValueError, HTTPException, Exception) as e:
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
                verified_initiative: Initiative | None = None
                if data.initiative_id:
                    try:
                        init_uuid = uuid.UUID(data.initiative_id)
                        verified_initiative, _role = await get_initiative_with_role(db, init_uuid, user)
                        project_context = _build_project_context(verified_initiative)
                    except (ValueError, HTTPException):
                        yield f"data: {json.dumps({'type': 'error', 'message': 'You do not have access to this project.'})}\n\n"
                        return

            if not compare_contexts:
                _tool_hint = data.tool_hint or ""
                if _tool_hint == "pdd" and data.initiative_id:
                    if not verified_initiative:
                        yield f"data: {json.dumps({'type': 'error', 'message': 'Project access required for PDD generation.'})}\n\n"
                        return
                    from app.services.pdd_service import PDDService
                    from app.services.chat import ChatResponse

                    init_uuid = verified_initiative.id

                    async def _run_pdd_setup():
                        pdd_svc = PDDService(db)
                        if on_thinking:
                            await on_thinking("Scanning project materials...")
                        await pdd_svc.create_workspace(init_uuid)
                        await pdd_svc.scan_project(init_uuid)
                        if on_thinking:
                            await on_thinking("Generating PDD outline...")
                        outline = await pdd_svc.generate_outline(init_uuid)
                        workspace_state = await pdd_svc.get_workspace(init_uuid)

                        section_count = len(outline)
                        text = (
                            f"I've reviewed your project materials and generated a "
                            f"**{section_count}-section** PDD outline.\n\n"
                            "Review and edit the outline in the panel on the right — "
                            "you can rename, reorder, add, or remove sections. "
                            "When you're happy with it, click **Confirm Outline** to start drafting."
                        )
                        return ChatResponse(
                            content=text,
                            sources=[],
                            tiers_used=["pdd_scan"],
                            latency_ms=0,
                            widget_type="pdd_workspace",
                            widget_data=workspace_state,
                        )

                    generation_task = asyncio.create_task(_run_pdd_setup())
                elif _tool_hint in ("investment_memo", "due_diligence_checklist") and data.initiative_id:
                    if not verified_initiative:
                        yield f"data: {json.dumps({'type': 'error', 'message': 'Project access required for document generation.'})}\n\n"
                        return
                    from app.api.alignment_helpers import (
                        get_or_generate_alignment,
                        build_alignment_widget_data,
                        get_alignment_intro_message,
                    )
                    from app.tools import get_tool_registry as _get_registry
                    from app.services.chat import ChatResponse
                    from sqlalchemy.orm.attributes import flag_modified

                    _registry = _get_registry()
                    _align_tool = _registry.get_tool(_tool_hint)
                    _align_initiative = verified_initiative

                    async def _run_alignment():
                        if on_thinking:
                            await on_thinking("Preparing outline...")
                        existing = list(_align_initiative.selected_tools or [])
                        if existing != [_tool_hint]:
                            _align_initiative.selected_tools = [_tool_hint]
                            ta = dict(_align_initiative.tool_alignments or {})
                            for oid in existing:
                                if oid != _tool_hint and oid in ta:
                                    del ta[oid]
                            _align_initiative.tool_alignments = ta
                            flag_modified(_align_initiative, "selected_tools")
                            flag_modified(_align_initiative, "tool_alignments")
                            await db.commit()
                            await db.refresh(_align_initiative)

                        alignment_data = await get_or_generate_alignment(db, _align_initiative, _tool_hint)
                        if not alignment_data:
                            return ChatResponse(
                                content=f"I wasn't able to generate an outline for {_align_tool.definition.name}. Please try again.",
                                sources=[], tiers_used=[], latency_ms=0,
                            )

                        pending = _align_initiative.get_pending_alignment_tools()
                        wd = build_alignment_widget_data(
                            tool_id=_tool_hint,
                            alignment_data=alignment_data,
                            pending_tool_ids=[t for t in pending if t != _tool_hint],
                        )
                        wd["session_id"] = str(session.id)
                        intro = get_alignment_intro_message(_align_tool.definition.name)
                        return ChatResponse(
                            content=intro,
                            sources=[], tiers_used=["alignment"], latency_ms=0,
                            widget_type="alignment", widget_data=wd,
                        )

                    generation_task = asyncio.create_task(_run_alignment())
                elif _tool_hint.startswith("template_fill:") and data.initiative_id:
                    if not verified_initiative:
                        yield f"data: {json.dumps({'type': 'error', 'message': 'Project access required for template analysis.'})}\n\n"
                        return
                    template_id_str = _tool_hint.split(":", 1)[1]
                    from app.tools.template_tool import TemplateFillTool
                    from app.services.chat import ChatResponse

                    tmpl_tool = TemplateFillTool()
                    init_uuid = verified_initiative.id

                    async def _run_template():
                        wt, wd = await tmpl_tool.execute_from_template(
                            db=db,
                            initiative_id=init_uuid,
                            template_id=uuid.UUID(template_id_str),
                            on_progress=on_thinking,
                        )
                        summary = wd.get("summary", {})
                        supported = summary.get("supported", 0)
                        total = summary.get("total", 0)
                        missing = summary.get("missing", 0)
                        form_summary = wd.get("form_summary", "")
                        text = (
                            f"I've analyzed your template **{wd.get('filename', 'document')}** "
                            f"and identified **{total}** requirements.\n\n"
                        )
                        if form_summary:
                            text += f"{form_summary}\n\n"
                        text += (
                            f"- **{supported}** are already supported by your project materials\n"
                            f"- **{missing}** are missing and need your input\n\n"
                            "Review the requirements panel on the right. You can confirm "
                            "values, provide missing information directly, or click any "
                            "requirement to investigate it."
                        )
                        return ChatResponse(
                            content=text,
                            sources=[],
                            tiers_used=["template_analysis"],
                            latency_ms=0,
                            widget_type=wt,
                            widget_data=wd,
                        )

                    generation_task = asyncio.create_task(_run_template())
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

            # Sync generated deliverables when a project is in context and the
            # result widget represents a completed, exportable tool output.
            if verified_initiative and result.widget_type and result.widget_data:
                _WIDGET_TO_TOOL: dict[str, str] = {
                    "lcoe_output": "lcoe_model",
                    "lcoe_inputs": "lcoe_model",
                    "carbon_output": "carbon_model",
                    "carbon_inputs": "carbon_model",
                    "solar_output": "solar_estimate",
                    "solar_inputs": "solar_estimate",
                }
                _tool_id = _WIDGET_TO_TOOL.get(result.widget_type or "")
                if _tool_id:
                    from app.tools.registry import get_tool_registry
                    _tool = get_tool_registry().get_tool(_tool_id)
                    _content = result.widget_data or {}
                    if _tool and _tool.is_exportable(_content):
                        _res = _content.get("result") or {}
                        if _tool_id == "lcoe_model":
                            _lcoe = _res.get("lcoe", 0)
                            _cur = _res.get("currency", "USD")
                            _title = f"LCOE Model ({_cur} {_lcoe:.4f}/kWh)"
                        elif _tool_id == "carbon_model":
                            _er = _res.get("net_er_tco2e", 0)
                            _title = f"Carbon ER Model ({_er:,.2f} tCO\u2082e/yr)"
                        elif _tool_id == "solar_estimate":
                            _kwh = _res.get("annual_kwh", 0)
                            _title = f"Solar Estimate ({_kwh:,.0f} kWh/yr)"
                        else:
                            _title = _tool.definition.name
                        verified_initiative.save_deliverable(
                            _tool_id,
                            _title,
                            _tool.definition.output_type,
                            _content,
                        )

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

    # Keep initiative.deliverables in sync when a model widget is recalculated.
    session = await db.get(CoreChatSession, msg.session_id)
    if session and session.initiative_id:
        try:
            init_uuid = uuid.UUID(str(session.initiative_id))
            initiative_result = await db.execute(
                select(Initiative).where(Initiative.id == init_uuid)
            )
            init_obj = initiative_result.scalar_one_or_none()
            if init_obj:
                _WIDGET_TO_TOOL: dict[str, str] = {
                    "lcoe_output": "lcoe_model",
                    "lcoe_inputs": "lcoe_model",
                    "carbon_output": "carbon_model",
                    "carbon_inputs": "carbon_model",
                    "solar_output": "solar_estimate",
                    "solar_inputs": "solar_estimate",
                }
                _tool_id = _WIDGET_TO_TOOL.get(msg.widget_type or "")
                if _tool_id:
                    from app.tools.registry import get_tool_registry
                    _tool = get_tool_registry().get_tool(_tool_id)
                    _content = data.widget_data or {}
                    if _tool and _tool.is_exportable(_content):
                        _res = _content.get("result") or {}
                        if _tool_id == "lcoe_model":
                            _lcoe = _res.get("lcoe", 0)
                            _cur = _res.get("currency", "USD")
                            _title = f"LCOE Model ({_cur} {_lcoe:.4f}/kWh)"
                        elif _tool_id == "carbon_model":
                            _er = _res.get("net_er_tco2e", 0)
                            _title = f"Carbon ER Model ({_er:,.2f} tCO\u2082e/yr)"
                        elif _tool_id == "solar_estimate":
                            _kwh = _res.get("annual_kwh", 0)
                            _title = f"Solar Estimate ({_kwh:,.0f} kWh/yr)"
                        else:
                            _title = _tool.definition.name
                        init_obj.save_deliverable(
                            _tool_id,
                            _title,
                            _tool.definition.output_type,
                            _content,
                        )
        except Exception:
            pass  # Never block the widget update if deliverable sync fails

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


# ---------------------------------------------------------------------------
# Alignment endpoints (for memo / checklist generation via the chat flow)
# ---------------------------------------------------------------------------

class AlignmentConfirmRequest(BaseModel):
    tool_id: str
    sections: list[dict] | None = None
    parameters: list[dict] | None = None


class AlignmentFeedbackRequest(BaseModel):
    tool_id: str
    feedback: str = Field(..., min_length=1, max_length=5000)


class AlignmentMessageOut(BaseModel):
    id: str
    role: str
    content: str
    widget_type: str | None = None
    widget_data: dict | None = None
    created_at: str | None = None


class AlignmentConfirmResponse(BaseModel):
    alignment: dict
    message: str
    new_messages: list[AlignmentMessageOut] = []


@router.post("/chat/sessions/{session_id}/alignment/confirm")
async def confirm_chat_alignment(
    session_id: str,
    data: AlignmentConfirmRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_ai_access),
):
    """Confirm alignment and generate the deliverable, saving messages to the chat session."""
    session = await db.get(CoreChatSession, uuid.UUID(session_id))
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    from app.core.permissions import require_editor
    initiative = await require_editor(db, session.initiative_id, user)

    alignment_data = initiative.get_alignment_for_tool(data.tool_id)
    if not alignment_data:
        raise HTTPException(status_code=400, detail=f"No alignment found for tool {data.tool_id}")

    if data.sections:
        alignment_data["sections"] = data.sections
    if data.parameters:
        alignment_data["parameters"] = data.parameters

    alignment_data["confirmed"] = True
    alignment_data["feedback"] = None
    initiative.set_alignment_for_tool(data.tool_id, alignment_data)
    await db.commit()
    await db.refresh(initiative)

    from app.tools import get_tool_registry
    from app.tools.base import ToolAlignment

    registry = get_tool_registry()
    tool = registry.get_tool(data.tool_id)
    tool_name = tool.definition.name if tool else data.tool_id

    new_messages: list[AlignmentMessageOut] = []

    confirm_text = f"Perfect! The {tool_name} outline is confirmed. Generating your deliverable now..."
    confirm_msg = CoreChatMessage(
        session_id=session.id, role="assistant", content=confirm_text,
    )
    db.add(confirm_msg)
    await db.flush()
    new_messages.append(AlignmentMessageOut(
        id=str(confirm_msg.id), role="assistant", content=confirm_text,
        created_at=confirm_msg.created_at.isoformat() if confirm_msg.created_at else None,
    ))

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

    WIDGET_TYPES = {"memo": "memo_viewer", "checklist": "checklist_viewer"}
    WIDGET_LABELS = {"memo_viewer": "Investment Memo", "checklist_viewer": "Due Diligence Checklist"}

    if tool and tool.requires_alignment:
        try:
            alignment_obj = ToolAlignment.from_dict(alignment_data)
            output = await tool.execute(
                db=db,
                initiative_id=initiative.id,
                inputs=inputs,
                include_corpus=True,
                alignment=alignment_obj,
            )
            initiative.save_deliverable(
                data.tool_id, output.title, output.output_type, output.content,
            )
            w_type = WIDGET_TYPES.get(output.output_type, "document_viewer")
            label = WIDGET_LABELS.get(w_type, tool_name)
            deliverable_msg = CoreChatMessage(
                session_id=session.id,
                role="assistant",
                content=f"Here's your **{label}** — review it in the editor and export when ready.",
                widget_type=w_type,
                widget_data={"content": output.content},
            )
            db.add(deliverable_msg)
            await db.flush()
            new_messages.append(AlignmentMessageOut(
                id=str(deliverable_msg.id), role="assistant",
                content=deliverable_msg.content,
                widget_type=w_type,
                widget_data={"content": output.content},
                created_at=deliverable_msg.created_at.isoformat() if deliverable_msg.created_at else None,
            ))
        except Exception as e:
            logger.error(f"Failed to generate {data.tool_id}: {e}", exc_info=True)
            err_msg = CoreChatMessage(
                session_id=session.id, role="assistant",
                content=f"I wasn't able to generate the {tool_name} right now. Please try again.",
            )
            db.add(err_msg)
            await db.flush()
            new_messages.append(AlignmentMessageOut(
                id=str(err_msg.id), role="assistant", content=err_msg.content,
                created_at=err_msg.created_at.isoformat() if err_msg.created_at else None,
            ))

    await db.commit()
    return AlignmentConfirmResponse(
        alignment=alignment_data,
        message=confirm_text,
        new_messages=new_messages,
    )


@router.post("/chat/sessions/{session_id}/alignment/feedback")
async def provide_chat_alignment_feedback(
    session_id: str,
    data: AlignmentFeedbackRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_ai_access),
):
    """Provide feedback to update an alignment within a chat session."""
    session = await db.get(CoreChatSession, uuid.UUID(session_id))
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    from app.core.permissions import require_editor
    initiative = await require_editor(db, session.initiative_id, user)

    alignment_data = initiative.get_alignment_for_tool(data.tool_id)
    if not alignment_data:
        raise HTTPException(status_code=400, detail=f"No alignment found for tool {data.tool_id}")

    from app.tools import get_tool_registry
    from app.tools.base import ToolAlignment
    from app.api.alignment_helpers import build_alignment_widget_data

    registry = get_tool_registry()
    tool = registry.get_tool(data.tool_id)
    if not tool:
        raise HTTPException(status_code=400, detail=f"Tool {data.tool_id} not found")

    current_alignment = ToolAlignment.from_dict(alignment_data)
    try:
        updated_alignment = await tool.update_alignment_from_feedback(
            current_alignment=current_alignment,
            feedback=data.feedback,
            db=db,
            initiative_id=initiative.id,
        )
        updated_data = updated_alignment.to_dict()
    except Exception as e:
        logger.error(f"Failed to update alignment from feedback: {e}")
        alignment_data["feedback"] = data.feedback
        updated_data = alignment_data

    initiative.set_alignment_for_tool(data.tool_id, updated_data)
    await db.commit()
    await db.refresh(initiative)

    user_msg = CoreChatMessage(
        session_id=session.id, role="user", content=data.feedback,
    )
    db.add(user_msg)

    tool_name = tool.definition.name
    pending = initiative.get_pending_alignment_tools()
    pending_others = [tid for tid in pending if tid != data.tool_id]

    wd = build_alignment_widget_data(
        tool_id=data.tool_id,
        alignment_data=updated_data,
        pending_tool_ids=pending_others,
    )
    wd["session_id"] = str(session.id)

    assistant_msg = CoreChatMessage(
        session_id=session.id,
        role="assistant",
        content=f"I've updated the {tool_name} outline based on your feedback. Please review the changes.",
        widget_type="alignment",
        widget_data=wd,
    )
    db.add(assistant_msg)
    await db.flush()
    await db.commit()

    new_messages = [
        AlignmentMessageOut(
            id=str(user_msg.id), role="user", content=data.feedback,
            created_at=user_msg.created_at.isoformat() if user_msg.created_at else None,
        ),
        AlignmentMessageOut(
            id=str(assistant_msg.id), role="assistant",
            content=assistant_msg.content,
            widget_type="alignment", widget_data=wd,
            created_at=assistant_msg.created_at.isoformat() if assistant_msg.created_at else None,
        ),
    ]

    return AlignmentConfirmResponse(
        alignment=updated_data,
        message=f"Updated {tool_name} outline based on your feedback.",
        new_messages=new_messages,
    )
