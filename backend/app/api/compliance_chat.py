"""Standalone compliance & program design chat endpoint with SSE streaming."""

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI
import json
import asyncio
import logging

from app.core.database import get_db
from app.core.auth import get_current_user, MockUser
from app.config import get_settings
from app.services.compliance_chat import ComplianceChatService

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()


class ChatHistoryMessage(BaseModel):
    role: str
    content: str


class ComplianceChatRequest(BaseModel):
    content: str
    history: list[ChatHistoryMessage] = []


class TitleRequest(BaseModel):
    message: str


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
      - complete: final payload with citations and metadata
    """

    async def generate():
        try:
            thinking_queue: asyncio.Queue[str] = asyncio.Queue()

            async def on_thinking(text: str):
                event = {"type": "thinking", "text": text}
                await thinking_queue.put(json.dumps(event))

            history = [{"role": m.role, "content": m.content} for m in data.history]
            service = ComplianceChatService(db)

            generation_task = asyncio.create_task(
                service.generate_response(
                    user_message=data.content,
                    history=history,
                    on_thinking=on_thinking,
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

            # Stream response token-by-token, preserving newlines embedded in tokens
            # split(' ') keeps '\n' attached to adjacent words so markdown structure
            # (headers, bullets, paragraphs) is preserved during streaming.
            tokens = [t for t in result.content.split(' ') if t]
            for i, token in enumerate(tokens):
                chunk = {"type": "word", "content": token, "is_last": i == len(tokens) - 1}
                yield f"data: {json.dumps(chunk)}\n\n"
                await asyncio.sleep(0.02)

            # Final complete event
            sources_list = [s.to_dict() for s in result.sources]
            complete = {
                "type": "complete",
                "content": result.content,
                "sources": sources_list,
                "tiers_used": result.tiers_used,
                "citation_count": len([s for s in result.sources if s.source_type.value != "llm_estimate"]),
                "latency_ms": result.latency_ms,
                "widget_type": result.widget_type,
                "widget_data": result.widget_data,
            }
            yield f"data: {json.dumps(complete)}\n\n"

        except Exception as e:
            logger.error(f"Compliance chat stream error: {e}", exc_info=True)
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
