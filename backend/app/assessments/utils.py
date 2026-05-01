"""Shared helpers for assessment-style assessments (build state, LLM JSON, build items)."""

from __future__ import annotations

import json
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


async def llm_json(
    system: str,
    user_msg: str,
    model: str = "gpt-4.1-mini",
) -> dict:
    """Call the platform OpenAI client and return parsed JSON. Returns {} on any error."""
    from app.core.llm_client import get_openai_client
    try:
        client, _is_byok = await get_openai_client(None, None)
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_msg},
            ],
            response_format={"type": "json_object"},
        )
        return json.loads(response.choices[0].message.content)
    except Exception as exc:
        logger.error("LLM JSON call failed: %s", exc)
        return {}


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
