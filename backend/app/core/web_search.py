"""Web search billed to the active provider key."""

from __future__ import annotations

import asyncio
import logging
from typing import Any
from urllib.parse import urlparse

import litellm
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.llm_client import record_usage_from_response
from app.core.llm_invoke import _litellm_model_id
from app.core.model_catalog import Complexity, ModelRole
from app.core.model_router import resolve

logger = logging.getLogger(__name__)

WEB_SEARCH_TIMEOUT_SECONDS = 90.0


def _default_search_input(query: str) -> str:
    return (
        f"Search the web for the most relevant and authoritative information about: {query}\n\n"
        "Summarize the most relevant findings, citing authoritative sources."
    )


async def run_web_search(
    user_id: str | None,
    db: AsyncSession | None,
    query: str,
    *,
    input_text: str | None = None,
    search_context_size: str = "medium",
) -> tuple[str, list[dict[str, Any]]]:
    """
    Returns (summary_text, citations) where each citation has url, title, snippet,
    and optionally start_index/end_index when the provider supplies span annotations.
    """
    target = await resolve(
        user_id,
        db,
        ModelRole.WEB_SEARCH,
        Complexity.STANDARD,
        require_web_search=True,
    )
    prompt = input_text or _default_search_input(query)
    if target.use_openai_responses_web_search:
        return await _openai_responses_search(
            user_id, db, prompt, target, search_context_size, is_byok=target.is_byok
        )
    return await _openrouter_online_search(user_id, db, prompt, target)


async def _openai_responses_search(
    user_id: str | None,
    db: AsyncSession | None,
    prompt: str,
    target: Any,
    search_context_size: str,
    *,
    is_byok: bool,
) -> tuple[str, list[dict[str, Any]]]:
    client = AsyncOpenAI(api_key=target.api_key, base_url=target.api_base)
    resp = await asyncio.wait_for(
        client.responses.create(
            model=target.litellm_model,
            tools=[{"type": "web_search", "search_context_size": search_context_size}],
            input=prompt,
        ),
        timeout=WEB_SEARCH_TIMEOUT_SECONDS,
    )
    if user_id and db:
        await record_usage_from_response(
            user_id, target.billing_model, resp, db, is_byok=is_byok
        )
    return _parse_openai_responses_output(resp)


async def _openrouter_online_search(
    user_id: str | None,
    db: AsyncSession | None,
    prompt: str,
    target: Any,
) -> tuple[str, list[dict[str, Any]]]:
    model = _litellm_model_id(target)
    if ":online" not in model:
        model = f"{model}:online"
    resp = await asyncio.wait_for(
        litellm.acompletion(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            api_key=target.api_key,
            api_base=target.api_base,
        ),
        timeout=WEB_SEARCH_TIMEOUT_SECONDS,
    )
    if user_id and db:
        await record_usage_from_response(
            user_id, target.billing_model, resp, db, is_byok=target.is_byok
        )
    text = resp.choices[0].message.content or ""
    citations: list[dict[str, str]] = []
    for token in text.split():
        if token.startswith("http"):
            url = token.rstrip(".,)")
            citations.append({"url": url, "title": urlparse(url).netloc, "snippet": ""})
    return text, citations


def _parse_openai_responses_output(resp: Any) -> tuple[str, list[dict[str, Any]]]:
    """Extract message text and url_citation annotations with character spans.

    Duplicate URLs are preserved when they cite different spans so callers can
    map each annotation onto the sentence that used it.
    """
    citations: list[dict[str, Any]] = []
    summary_parts: list[str] = []
    # Running offset into the joined summary text ("\n".join(parts)).
    text_offset = 0

    for item in resp.output:
        if getattr(item, "type", None) != "message":
            continue
        for block in item.content:
            text = getattr(block, "text", "") or ""
            if text:
                if summary_parts:
                    text_offset += 1  # account for the join newline
                summary_parts.append(text)
            for ann in getattr(block, "annotations", []) or []:
                if getattr(ann, "type", None) != "url_citation":
                    continue
                url = getattr(ann, "url", "") or ""
                if not url:
                    continue
                start_index = getattr(ann, "start_index", None)
                end_index = getattr(ann, "end_index", None)
                citations.append(
                    {
                        "url": url,
                        "title": getattr(ann, "title", "") or urlparse(url).netloc,
                        "snippet": text[:400] if text else "",
                        "start_index": (
                            start_index + text_offset if isinstance(start_index, int) else None
                        ),
                        "end_index": (
                            end_index + text_offset if isinstance(end_index, int) else None
                        ),
                    }
                )
            if text:
                text_offset += len(text)

    return "\n".join(summary_parts), citations
