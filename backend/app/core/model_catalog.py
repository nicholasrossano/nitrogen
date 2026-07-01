"""Curated model allowlist: role × complexity × provider route."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class ModelRole(str, Enum):
    ORCHESTRATION = "orchestration"
    GENERATION = "generation"
    EMBEDDING = "embedding"
    ASSESSMENT_WRITEUP = "assessment_writeup"
    WEB_SEARCH = "web_search"


class Complexity(str, Enum):
    LIGHT = "light"
    STANDARD = "standard"
    HEAVY = "heavy"


ProviderRoute = str  # "openai" | "openrouter"


@dataclass(frozen=True)
class ModelSpec:
    litellm_model: str
    billing_model: str
    supports_web_search: bool = False
    supports_tools: bool = True
    supports_json_mode: bool = True


def _or_models() -> dict[tuple[ModelRole, Complexity], ModelSpec]:
    """OpenRouter-routed models (platform + OpenRouter BYOK)."""
    return {
        (ModelRole.ORCHESTRATION, Complexity.LIGHT): ModelSpec(
            "openai/gpt-4o-mini", "gpt-4o-mini", supports_web_search=True
        ),
        (ModelRole.ORCHESTRATION, Complexity.STANDARD): ModelSpec(
            "openai/gpt-4o", "gpt-4o", supports_web_search=True
        ),
        (ModelRole.ORCHESTRATION, Complexity.HEAVY): ModelSpec(
            "openai/gpt-4.1", "gpt-4.1", supports_web_search=True
        ),
        (ModelRole.GENERATION, Complexity.LIGHT): ModelSpec(
            "openai/gpt-4o-mini", "gpt-4o-mini"
        ),
        (ModelRole.GENERATION, Complexity.STANDARD): ModelSpec(
            "openai/gpt-4o-mini", "gpt-4o-mini"
        ),
        (ModelRole.GENERATION, Complexity.HEAVY): ModelSpec(
            "openai/gpt-4o", "gpt-4o"
        ),
        (ModelRole.EMBEDDING, Complexity.STANDARD): ModelSpec(
            "openai/text-embedding-ada-002", "text-embedding-ada-002"
        ),
        (ModelRole.ASSESSMENT_WRITEUP, Complexity.HEAVY): ModelSpec(
            "openai/gpt-4.1", "gpt-4.1"
        ),
        (ModelRole.WEB_SEARCH, Complexity.STANDARD): ModelSpec(
            "openai/gpt-4o", "gpt-4o", supports_web_search=True
        ),
    }


def _openai_models() -> dict[tuple[ModelRole, Complexity], ModelSpec]:
    """Direct OpenAI BYOK — OpenAI catalog only."""
    return {
        (ModelRole.ORCHESTRATION, Complexity.LIGHT): ModelSpec(
            "gpt-4o-mini", "gpt-4o-mini", supports_web_search=True
        ),
        (ModelRole.ORCHESTRATION, Complexity.STANDARD): ModelSpec(
            "gpt-4o", "gpt-4o", supports_web_search=True
        ),
        (ModelRole.ORCHESTRATION, Complexity.HEAVY): ModelSpec(
            "gpt-4.1", "gpt-4.1", supports_web_search=True
        ),
        (ModelRole.GENERATION, Complexity.LIGHT): ModelSpec(
            "gpt-4o-mini", "gpt-4o-mini"
        ),
        (ModelRole.GENERATION, Complexity.STANDARD): ModelSpec(
            "gpt-4o-mini", "gpt-4o-mini"
        ),
        (ModelRole.GENERATION, Complexity.HEAVY): ModelSpec(
            "gpt-4o", "gpt-4o"
        ),
        (ModelRole.EMBEDDING, Complexity.STANDARD): ModelSpec(
            "text-embedding-ada-002", "text-embedding-ada-002"
        ),
        (ModelRole.ASSESSMENT_WRITEUP, Complexity.HEAVY): ModelSpec(
            "gpt-4.1", "gpt-4.1"
        ),
        (ModelRole.WEB_SEARCH, Complexity.STANDARD): ModelSpec(
            "gpt-4o", "gpt-4o", supports_web_search=True
        ),
    }


_CATALOGS: dict[ProviderRoute, dict[tuple[ModelRole, Complexity], ModelSpec]] = {
    "openrouter": _or_models(),
    "openai": _openai_models(),
}

# Roles that only have STANDARD tier in catalog
_SINGLE_TIER_ROLES = {ModelRole.EMBEDDING, ModelRole.WEB_SEARCH, ModelRole.ASSESSMENT_WRITEUP}


def get_model_spec(
    provider_route: ProviderRoute,
    role: ModelRole,
    complexity: Complexity,
    *,
    require_web_search: bool = False,
) -> ModelSpec:
    catalog = _CATALOGS.get(provider_route, _CATALOGS["openrouter"])
    if role in _SINGLE_TIER_ROLES:
        complexity = Complexity.STANDARD if role != ModelRole.ASSESSMENT_WRITEUP else Complexity.HEAVY

    spec = catalog.get((role, complexity))
    if spec is None:
        # Fallback down tiers, then to STANDARD orchestration
        for fallback in (complexity, Complexity.STANDARD, Complexity.LIGHT):
            spec = catalog.get((role, fallback))
            if spec:
                break
    if spec is None:
        spec = catalog[(ModelRole.ORCHESTRATION, Complexity.STANDARD)]

    if require_web_search and not spec.supports_web_search:
        ws = catalog.get((ModelRole.WEB_SEARCH, Complexity.STANDARD))
        if ws:
            spec = ws
    return spec


def validate_override(provider_route: ProviderRoute, model_id: str) -> bool:
    """True if model_id appears in the allowlist for this provider route."""
    catalog = _CATALOGS.get(provider_route, _CATALOGS["openrouter"])
    allowed = {s.litellm_model for s in catalog.values()} | {s.billing_model for s in catalog.values()}
    return model_id in allowed
