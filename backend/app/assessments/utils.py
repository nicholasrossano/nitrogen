"""Shared helpers for assessment-style assessments (build state, LLM JSON, build items)."""

from __future__ import annotations

import logging
import uuid

logger = logging.getLogger(__name__)


def get_build_stage(build: dict, stage_id: str) -> dict | None:
    """Return the stage entry matching stage_id from build.stages, or None."""
    for s in build.get("stages", []):
        if s["id"] == stage_id:
            return s
    return None


def layers_as_dict(build: dict) -> dict[str, dict]:
    """Return a {stage_id: {items, status}} dict for use in generate_layer prior_layers arg."""
    return {
        s["id"]: {"items": s.get("items") or [], "status": s.get("status", "pending")}
        for s in build.get("stages", [])
    }


def _resolve_billing_context(
    *,
    user_id: str | None,
    db,
    context: dict | None,
) -> tuple[str | None, object | None]:
    """Resolve user_id/db for usage tracking from explicit args or workflow context."""
    resolved_user_id = user_id or ((context or {}).get("user_id"))
    resolved_db = db or ((context or {}).get("_db"))
    return resolved_user_id, resolved_db


async def llm_json(
    system: str,
    user_msg: str,
    model: str = "gpt-4.1-mini",
    *,
    user_id: str | None = None,
    db=None,
    context: dict | None = None,
) -> dict:
    """Call OpenAI and return parsed JSON. Records usage when user_id/db are available."""
    from app.core.llm_invoke import acompletion_json
    from app.core.model_catalog import Complexity, ModelRole

    resolved_user_id, resolved_db = _resolve_billing_context(
        user_id=user_id, db=db, context=context
    )
    role = (
        ModelRole.ASSESSMENT_WRITEUP
        if model in ("gpt-4.1", "gpt-4.1-mini")
        else ModelRole.ORCHESTRATION
    )
    complexity = Complexity.HEAVY if model == "gpt-4.1" else Complexity.STANDARD
    return await acompletion_json(
        resolved_user_id,
        resolved_db,
        role=role,
        complexity=complexity,
        model=model,
        system=system,
        user_msg=user_msg,
    )


def make_build_item(content: dict, derivation: str = "inferred", sources: list[dict] | None = None, rationale: str = "") -> dict:
    """Create a standardised build item dict."""
    return {
        "id": str(uuid.uuid4()),
        "content": content,
        "origin": derivation,
        "provenance": {
            "derivation": derivation,
            "sources": sources or [],
            "rationale": rationale,
        },
        "confirmed": False,
        "confirmed_at": None,
        "removable": True,
    }


def default_project_context_prompt(context: dict) -> str:
    """Shared project-context block for category / entity proposal prompts."""
    return (
        f"Project: {context.get('project_title', 'Unknown')}\n"
        f"Geography / region: {context.get('geography', '')}\n"
        f"Project type / sector: {context.get('project_type', '')}\n"
        f"Project description: {context.get('project_description', '')}"
    )


async def propose_category_items(
    *,
    system: str,
    context: dict,
    user_msg: str | None = None,
    result_key: str = "categories",
) -> list[dict]:
    """Shared LLM category-list proposal for layered assessments.

    Assessments supply unique ``system`` prompts; parsing/normalization is shared.
    """
    data = await llm_json(
        system=system,
        user_msg=user_msg or default_project_context_prompt(context),
        context=context,
    )
    raw = data.get(result_key)
    if not isinstance(raw, list):
        raw = data.get("categories")
    if not isinstance(raw, list):
        raw = data.get("themes")
    if not isinstance(raw, list):
        return []

    items: list[dict] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        label = str(entry.get("label") or entry.get("title") or "").strip()
        if not label:
            continue
        items.append(
            {
                "label": label,
                "description": str(entry.get("description") or ""),
                "icon": infer_category_icon(label),
            }
        )
    return items


def infer_category_icon(label: str) -> str:
    """Infer a deterministic icon name from a category label."""
    normalized = (label or "").strip().lower()
    icon_by_keyword = [
        ("TrendingUp", ["market", "demand", "growth", "viability", "economic"]),
        ("Zap", ["technology", "tech", "innovation", "energy", "electrification"]),
        ("Scale", ["policy", "regulatory", "compliance", "legal", "governance"]),
        ("Users", ["stakeholder", "community", "consumer", "user", "household"]),
        ("Leaf", ["environment", "climate", "emission", "carbon", "ecology"]),
        ("CircleDollarSign", ["financial", "finance", "funding", "investment", "cost"]),
        ("Truck", ["supply", "logistics", "distribution", "infrastructure", "value chain"]),
        ("Wrench", ["operations", "implementation", "maintenance", "capacity"]),
    ]
    for icon, keywords in icon_by_keyword:
        if any(keyword in normalized for keyword in keywords):
            return icon
    return "Compass"
