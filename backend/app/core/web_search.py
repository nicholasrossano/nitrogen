"""Web search billed to the active provider key."""

from __future__ import annotations

import asyncio
import logging
from typing import Any
from urllib.parse import urlparse

import litellm
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.llm_client import get_openai_client, record_usage_from_response
from app.core.llm_invoke import _litellm_model_id
from app.core.model_catalog import Complexity, ModelRole
from app.core.model_router import resolve

logger = logging.getLogger(__name__)
settings = get_settings()

WEB_SEARCH_TIMEOUT_SECONDS = 90.0


async def run_web_search(
    user_id: str | None,
    db: AsyncSession | None,
    query: str,
    *,
    search_context_size: str = "medium",
    is_byok: bool = False,
) -> tuple[str, list[dict[str, str]]]:
    """
    Returns (summary_text, citations) where each citation has url, title, snippet.
    """
    if settings.model_routing_enabled:
        target = await resolve(
            user_id,
            db,
            ModelRole.WEB_SEARCH,
            Complexity.STANDARD,
            require_web_search=True,
        )
        if target.use_openai_responses_web_search:
            return await _openai_responses_search(
                user_id, db, query, target, search_context_size, is_byok=target.is_byok
            )
        return await _openrouter_online_search(user_id, db, query, target)

    client, is_byok = await get_openai_client(user_id, db)
    model = settings.openai_orchestration_model
    resp = await asyncio.wait_for(
        client.responses.create(
            model=model,
            tools=[{"type": "web_search", "search_context_size": search_context_size}],
            input=(
                f"Search the web for the most relevant and authoritative information about: {query}\n\n"
                "Summarize the most relevant findings, citing authoritative sources."
            ),
        ),
        timeout=WEB_SEARCH_TIMEOUT_SECONDS,
    )
    if user_id and db:
        await record_usage_from_response(user_id, model, resp, db, is_byok=is_byok)
    return _parse_openai_responses_output(resp)


async def _openai_responses_search(
    user_id: str | None,
    db: AsyncSession | None,
    query: str,
    target: Any,
    search_context_size: str,
    *,
    is_byok: bool,
) -> tuple[str, list[dict[str, str]]]:
    client = AsyncOpenAI(api_key=target.api_key, base_url=target.api_base)
    resp = await asyncio.wait_for(
        client.responses.create(
            model=target.litellm_model,
            tools=[{"type": "web_search", "search_context_size": search_context_size}],
            input=(
                f"Search the web for the most relevant and authoritative information about: {query}\n\n"
                "Summarize the most relevant findings, citing authoritative sources."
            ),
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
    query: str,
    target: Any,
) -> tuple[str, list[dict[str, str]]]:
    model = _litellm_model_id(target)
    if ":online" not in model:
        model = f"{model}:online"
    prompt = (
        f"Search the web for the most relevant and authoritative information about: {query}\n\n"
        "Summarize the most relevant findings with source URLs."
    )
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
    # OpenRouter may include annotations in provider-specific fields; extract URLs from text as fallback
    for token in text.split():
        if token.startswith("http"):
            url = token.rstrip(".,)")
            citations.append({"url": url, "title": urlparse(url).netloc, "snippet": ""})
    return text, citations


def _parse_openai_responses_output(resp: Any) -> tuple[str, list[dict[str, str]]]:
    citations: list[dict[str, str]] = []
    seen_urls: set[str] = set()
    summary_parts: list[str] = []

    for item in resp.output:
        if getattr(item, "type", None) != "message":
            continue
        for block in item.content:
            text = getattr(block, "text", "") or ""
            if text:
                summary_parts.append(text)
            for ann in getattr(block, "annotations", []) or []:
                if getattr(ann, "type", None) != "url_citation":
                    continue
                url = getattr(ann, "url", "") or ""
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)
                citations.append(
                    {
                        "url": url,
                        "title": getattr(ann, "title", "") or urlparse(url).netloc,
                        "snippet": text[:400] if text else "",
                    }
                )

    return "\n".join(summary_parts), citations
