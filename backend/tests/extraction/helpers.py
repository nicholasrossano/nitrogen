"""Helpers for extraction / de-dup golden fixtures."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

FIXTURES_ROOT = Path(__file__).resolve().parent.parent / "fixtures" / "extraction"


def discover_fixtures() -> list[Path]:
    if not FIXTURES_ROOT.is_dir():
        return []
    return sorted(p for p in FIXTURES_ROOT.glob("*.json") if p.name != "README.md")


def load_fixture(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text())
    for key in ("id", "source_type", "expect"):
        if key not in data:
            raise ValueError(f"{path.name}: missing required key '{key}'")
    return data


def _norm_label(value: str) -> str:
    return " ".join(str(value).lower().split())


def match_assumptions(
    predicted: list[dict[str, Any]],
    expected: list[dict[str, Any]],
) -> tuple[float, float, list[str]]:
    """Return precision, recall, and unmatched expected labels."""
    if not expected and not predicted:
        return 1.0, 1.0, []
    if not expected:
        return 0.0, 1.0, []
    if not predicted:
        return 1.0, 0.0, [str(e.get("label") or e.get("key")) for e in expected]

    used: set[int] = set()
    hits = 0
    unmatched: list[str] = []
    for exp in expected:
        exp_label = _norm_label(str(exp.get("label") or exp.get("key") or ""))
        exp_key = str(exp.get("key") or "").lower().strip()
        exp_value = exp.get("value")
        matched = False
        for idx, pred in enumerate(predicted):
            if idx in used:
                continue
            pred_label = _norm_label(str(pred.get("label") or pred.get("key") or ""))
            pred_key = str(pred.get("key") or "").lower().strip()
            label_ok = (
                (exp_label and exp_label == pred_label)
                or (exp_key and exp_key == pred_key)
                or (exp_label and exp_label in pred_label)
                or (pred_label and pred_label in exp_label)
            )
            if not label_ok:
                continue
            if exp_value is not None:
                if isinstance(exp_value, (int, float)) and isinstance(pred.get("value"), (int, float)):
                    if abs(float(pred["value"]) - float(exp_value)) > max(1e-6, abs(float(exp_value)) * 0.01):
                        continue
                elif pred.get("value") != exp_value:
                    continue
            quote_contains = exp.get("quote_contains")
            if quote_contains:
                quote = str(pred.get("source_quote") or pred.get("quote") or "")
                if quote_contains.lower() not in quote.lower():
                    continue
            used.add(idx)
            hits += 1
            matched = True
            break
        if not matched:
            unmatched.append(str(exp.get("label") or exp.get("key")))

    precision = hits / len(predicted) if predicted else 1.0
    recall = hits / len(expected) if expected else 1.0
    return precision, recall, unmatched


def run_recorded_extraction(fixture: dict[str, Any]) -> list[dict[str, Any]]:
    """Apply quality gate + grounding to frozen LLM JSON (deterministic CI path)."""
    from app.services.variables import (
        _passes_extraction_quality_gate,
        infer_variable_value_type,
        normalize_variable_key,
        normalize_missing_value,
    )
    from app.variables.config import VARIABLE_BY_KEY

    recorded = fixture.get("recorded_llm") or {}
    raw_items = recorded.get("variables") or []
    text = ""
    for material in (fixture.get("input") or {}).get("materials") or []:
        text += "\n" + str(material.get("content_text") or "")
    for chunk in (fixture.get("input") or {}).get("chunks") or []:
        text += "\n" + str(chunk.get("content") or "")

    out: list[dict[str, Any]] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        key = normalize_variable_key(str(raw.get("key") or raw.get("label") or ""))
        if not key:
            continue
        value = normalize_missing_value(raw.get("value"))
        if value is None:
            continue
        definition = VARIABLE_BY_KEY.get(key)
        value_type = raw.get("value_type") or (definition.value_type if definition else infer_variable_value_type(value))
        if not _passes_extraction_quality_gate(raw, value_type=value_type, definition=definition):
            continue
        quote = str(raw.get("source_quote") or "").strip()
        if quote:
            collapsed_quote = " ".join(quote.lower().split())
            collapsed_text = " ".join(text.lower().split())
            if collapsed_quote not in collapsed_text and collapsed_quote[:60] not in collapsed_text:
                continue
        out.append(
            {
                "key": definition.key if definition else key,
                "label": raw.get("label") or (definition.label if definition else key.replace("_", " ").title()),
                "value": value,
                "unit": raw.get("unit") or (definition.unit if definition else None),
                "value_type": value_type,
                "source_quote": quote,
            }
        )
    return out
