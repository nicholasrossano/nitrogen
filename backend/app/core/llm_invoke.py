"""Unified LLM invocation — LiteLLM when model_routing_enabled, else legacy OpenAI client."""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

import litellm
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.llm_client import get_openai_client, record_usage_from_response
from app.core.model_catalog import Complexity, ModelRole
from app.core.model_router import LLMTarget, resolve

logger = logging.getLogger(__name__)
settings = get_settings()

litellm.suppress_debug_info = True


def legacy_model_for_role(role: ModelRole) -> str:
    if role == ModelRole.EMBEDDING:
        return settings.openai_embedding_model
    if role in (ModelRole.GENERATION,):
        return settings.openai_generation_model
    return settings.openai_orchestration_model


async def _record(
    user_id: str | None,
    db: AsyncSession | None,
    billing_model: str,
    response: Any,
    *,
    is_byok: bool,
) -> None:
    if user_id and db:
        await record_usage_from_response(
            user_id, billing_model, response, db, is_byok=is_byok
        )


async def acompletion(
    user_id: str | None,
    db: AsyncSession | None,
    *,
    role: ModelRole,
    complexity: Complexity = Complexity.STANDARD,
    model_override: str | None = None,
    messages: list[dict[str, Any]],
    **kwargs: Any,
) -> Any:
    if settings.model_routing_enabled:
        target = await resolve(
            user_id,
            db,
            role,
            complexity,
            model_override=model_override,
        )
        response = await litellm.acompletion(
            model=_litellm_model_id(target),
            messages=messages,
            api_key=target.api_key,
            api_base=target.api_base,
            **kwargs,
        )
        await _record(user_id, db, target.billing_model, response, is_byok=target.is_byok)
        return response

    client, is_byok = await get_openai_client(user_id, db)
    model = model_override or legacy_model_for_role(role)
    response = await client.chat.completions.create(model=model, messages=messages, **kwargs)
    await _record(user_id, db, model, response, is_byok=is_byok)
    return response


async def acompletion_json(
    user_id: str | None,
    db: AsyncSession | None,
    *,
    role: ModelRole,
    complexity: Complexity = Complexity.STANDARD,
    model: str | None = None,
    system: str,
    user_msg: str,
) -> dict:
    try:
        response = await acompletion(
            user_id,
            db,
            role=role,
            complexity=complexity,
            model_override=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_msg},
            ],
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content
        return json.loads(content) if content else {}
    except Exception as exc:
        logger.error("LLM JSON call failed: %s", exc)
        return {}


async def aembedding(
    user_id: str | None,
    db: AsyncSession | None,
    *,
    texts: list[str] | str,
) -> list[list[float]]:
    single = isinstance(texts, str)
    inputs = [texts] if single else texts
    if not inputs:
        return []

    if settings.model_routing_enabled:
        target = await resolve(user_id, db, ModelRole.EMBEDDING, Complexity.STANDARD)
        response = await litellm.aembedding(
            model=_litellm_model_id(target),
            input=inputs,
            api_key=target.api_key,
            api_base=target.api_base,
        )
        await _record(user_id, db, target.billing_model, response, is_byok=target.is_byok)
        data = response.data
        embeddings = sorted(data, key=lambda x: x.index if hasattr(x, "index") else x["index"])
        vectors = [
            e.embedding if hasattr(e, "embedding") else e["embedding"] for e in embeddings
        ]
        return vectors[:1] if single else vectors

    client, is_byok = await get_openai_client(user_id, db)
    model = settings.openai_embedding_model
    response = await client.embeddings.create(model=model, input=inputs)
    await _record(user_id, db, model, response, is_byok=is_byok)
    ordered = sorted(response.data, key=lambda x: x.index)
    vectors = [e.embedding for e in ordered]
    return vectors[:1] if single else vectors


def _litellm_model_id(target: LLMTarget) -> str:
    if target.provider_route == "openrouter":
        return f"openrouter/{target.litellm_model}"
    return target.litellm_model


async def resolve_target(
    user_id: Optional[str],
    db: Optional[AsyncSession],
    role: ModelRole,
    complexity: Complexity = Complexity.STANDARD,
    **kwargs: Any,
) -> LLMTarget:
    return await resolve(user_id, db, role, complexity, **kwargs)
