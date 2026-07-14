"""Golden tests for assumption alias / fuzzy de-dup."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.assumption_dedup import (
    FUZZY_LABEL_THRESHOLD,
    fuzzy_label_match,
    merge_alias_list,
    resolve_canonical_assumption,
)
from tests.extraction.helpers import discover_fixtures, load_fixture


DEDUP_FIXTURES = [
    path for path in discover_fixtures() if load_fixture(path).get("source_type") == "dedup"
]


def test_fuzzy_threshold_is_conservative():
    assert FUZZY_LABEL_THRESHOLD >= 0.9
    # Near-identical misspellings should pass
    assert fuzzy_label_match("Net Present Value", "Net Present Vaule") >= FUZZY_LABEL_THRESHOLD
    # Distinct rates must not fuzzy-match
    assert fuzzy_label_match("Discount rate", "Inflation") < FUZZY_LABEL_THRESHOLD


@pytest.mark.asyncio
@pytest.mark.parametrize("fixture_path", DEDUP_FIXTURES, ids=lambda p: p.stem)
async def test_dedup_golden(fixture_path, monkeypatch):
    fixture = load_fixture(fixture_path)
    forms = fixture["input"]["surface_forms"]
    rows: list[SimpleNamespace] = []

    class FakeResult:
        def __init__(self, items):
            self._items = items

        def scalars(self):
            return self

        def all(self):
            return list(self._items)

    class FakeDb:
        async def execute(self, *_args, **_kwargs):
            return FakeResult(rows)

    db = FakeDb()
    project_id = uuid4()

    for form in forms:
        match = await resolve_canonical_assumption(
            db,
            project_id,
            key=form["key"],
            label=form["label"],
            existing_rows=rows,
        )
        if match is None:
            row = SimpleNamespace(
                id=uuid4(),
                key=form["key"],
                label=form["label"],
                aliases=[],
                status="extracted",
                value=form.get("value"),
            )
            rows.append(row)
        else:
            match.aliases = merge_alias_list(match.aliases, form["label"], form["key"])

    assert len(rows) == fixture["expect"]["canonical_count"], (
        f"{fixture['id']}: expected {fixture['expect']['canonical_count']} rows, got {len(rows)}"
    )
    aliases_include = fixture["expect"].get("aliases_include") or []
    if aliases_include:
        all_aliases = set()
        for row in rows:
            all_aliases.add(row.label)
            all_aliases.update(row.aliases or [])
        for needed in aliases_include:
            assert needed in all_aliases, f"{fixture['id']}: missing alias '{needed}' in {all_aliases}"
