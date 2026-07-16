"""Resolve incoming variables onto canonical project rows (exact / alias / fuzzy).

Prefer under-merge: a duplicate is safer than wrongly combining distinct variables.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.variables.config import VARIABLE_BY_KEY
from app.models.variable import Variable

# High threshold: under-merge preference for pre-launch.
FUZZY_LABEL_THRESHOLD = 0.92


def normalize_variable_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def _surface_forms(row: Variable) -> list[str]:
    forms = [row.key or "", row.label or ""]
    if isinstance(row.aliases, list):
        forms.extend(str(a) for a in row.aliases if a)
    return [f for f in forms if f]


def _config_alias_keys() -> dict[str, str]:
    """Map normalized alias / label / key -> canonical config key."""
    mapping: dict[str, str] = {}
    for definition in VARIABLE_BY_KEY.values():
        mapping[normalize_variable_key(definition.key)] = definition.key
        mapping[normalize_variable_key(definition.label)] = definition.key
        for alias in definition.aliases:
            mapping[normalize_variable_key(alias)] = definition.key
    return mapping


_CONFIG_ALIAS_KEYS = _config_alias_keys()


def merge_alias_list(existing: list[str] | None, *new_forms: str) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for form in [*(existing or []), *new_forms]:
        text = str(form or "").strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
    return out[:40]


def fuzzy_label_match(a: str, b: str) -> float:
    left = re.sub(r"\s+", " ", a.strip().lower())
    right = re.sub(r"\s+", " ", b.strip().lower())
    if not left or not right:
        return 0.0
    return SequenceMatcher(None, left, right).ratio()


async def resolve_canonical_variable(
    db: AsyncSession,
    project_id: UUID,
    *,
    key: str,
    label: str | None = None,
    existing_rows: Iterable[Variable] | None = None,
) -> Variable | None:
    """Return the best matching project variable, or None if none match safely."""
    normalized_key = normalize_variable_key(key)
    label_text = (label or "").strip()

    if existing_rows is None:
        result = await db.execute(
            select(Variable).where(
                Variable.project_id == project_id,
                Variable.status != "rejected",
            )
        )
        rows = list(result.scalars().all())
    else:
        rows = list(existing_rows)

    # 1) Exact key
    for row in rows:
        if normalize_variable_key(row.key) == normalized_key:
            return row

    # 2) Config alias seed -> exact row keyed by canonical key
    config_canonical = _CONFIG_ALIAS_KEYS.get(normalized_key)
    if label_text:
        config_canonical = config_canonical or _CONFIG_ALIAS_KEYS.get(normalize_variable_key(label_text))
    if config_canonical:
        for row in rows:
            if normalize_variable_key(row.key) == normalize_variable_key(config_canonical):
                return row

    # 3) Fuzzy label / aliases (high threshold)
    candidates: list[tuple[float, Variable]] = []
    probe_forms = [label_text, key.replace("_", " "), key]
    for row in rows:
        best = 0.0
        for surface in _surface_forms(row):
            for probe in probe_forms:
                if not probe:
                    continue
                best = max(best, fuzzy_label_match(probe, surface))
        if best >= FUZZY_LABEL_THRESHOLD:
            candidates.append((best, row))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    # If top two are close and different rows, refuse to merge (under-merge).
    if len(candidates) > 1 and candidates[0][0] - candidates[1][0] < 0.02:
        return None
    return candidates[0][1]
