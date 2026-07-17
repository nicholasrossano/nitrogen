"""Tests for assessment export orchestration (cache, lock, fingerprint)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from app.domain.energy.assessments.landscape_mapping import LandscapeMappingAssessment
from app.domain.energy.assessments.stakeholder_assessment import StakeholderAssessment
from app.services.assessment_export import (
    ExportInProgressError,
    begin_export_lock,
    clear_export_lock,
    fingerprint_payload,
    resolve_writeup_content,
)


def _make_inst(state=None):
    return SimpleNamespace(
        id=uuid4(),
        project_id=uuid4(),
        workflow_state=state or {},
        workflow_version=1,
    )


def test_fingerprint_payload_is_stable():
    a = fingerprint_payload({"b": 1, "a": [2, 3]})
    b = fingerprint_payload({"a": [2, 3], "b": 1})
    assert a == b
    assert a != fingerprint_payload({"a": [2, 3], "b": 2})


@pytest.mark.asyncio
@patch("app.services.assessment_export.save_workflow_state")
async def test_upsert_assessment_report_material_updates_same_row(_save):
    from unittest.mock import MagicMock

    from app.services.assessment_export import (
        REPORT_MATERIAL_ID_KEY,
        upsert_assessment_report_material,
    )

    project_id = uuid4()
    workspace_id = uuid4()
    material_id = uuid4()
    existing = SimpleNamespace(
        id=material_id,
        project_id=project_id,
        storage_path="old/path.docx",
        filename="landscape_n1_user_report.docx",
        file_type="docx",
        file_size=10,
        content_text="old",
    )
    inst = SimpleNamespace(id=uuid4(), project_id=project_id, workflow_state={})
    state = {REPORT_MATERIAL_ID_KEY: str(material_id)}

    result = MagicMock()
    result.scalar_one_or_none.return_value = existing
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    db.flush = AsyncMock()

    storage = AsyncMock()
    storage.save = AsyncMock(return_value="new/path.docx")
    storage.delete = AsyncMock(return_value=True)

    with (
        patch("app.core.storage.get_uploads_storage", return_value=storage),
        patch("app.services.document_parser.DocumentParserService") as parser_cls,
    ):
        parser_cls.return_value.parse_docx.return_value = "parsed"
        material, created = await upsert_assessment_report_material(
            db=db,
            inst=inst,
            state=state,
            content=b"docx-bytes",
            filename="landscape_n1_user_report.docx",
            workspace_id=workspace_id,
        )

    assert created is False
    assert material is existing
    assert existing.storage_path == "new/path.docx"
    assert existing.file_size == len(b"docx-bytes")
    storage.delete.assert_awaited_once_with("old/path.docx")


@patch("app.services.assessment_export.save_workflow_state")
def test_export_lock_blocks_concurrent_export(_save):
    inst = _make_inst()
    state: dict = {}
    begin_export_lock(inst, state)
    assert state["export_in_progress"] is True
    with pytest.raises(ExportInProgressError):
        begin_export_lock(inst, state)
    clear_export_lock(inst, state)
    assert state["export_in_progress"] is False
    begin_export_lock(inst, state)


@pytest.mark.asyncio
@patch("app.services.assessment_export.save_workflow_state")
async def test_resolve_writeup_reuses_cached_content(_save):
    assessment = StakeholderAssessment()
    confirmed = {
        "categories": {"status": "confirmed", "data": {"items": []}},
        "stakeholders": {"status": "confirmed", "data": {"items": []}},
    }
    fingerprint = assessment.export_input_fingerprint(confirmed, {})
    cached_content = {"title": "Cached Stakeholder Assessment", "executive_summary": "Hello"}
    state = {
        "stages": confirmed,
        "cached_exports": {
            "writeup": {
                "content": cached_content,
                "fingerprint": fingerprint,
                "invalidated": False,
            }
        },
    }
    inst = _make_inst(state)
    db = AsyncMock()

    assessment.generate_writeup_content = AsyncMock(side_effect=AssertionError("should not regenerate"))
    assessment.prepare_export_enrichment = AsyncMock(return_value=(confirmed, False))

    content, _stages = await resolve_writeup_content(
        assessment=assessment,
        inst=inst,
        state=state,
        confirmed_stages=confirmed,
        context={"project_title": "Test"},
        db=db,
    )
    assert content == cached_content
    assessment.generate_writeup_content.assert_not_called()


@pytest.mark.asyncio
@patch("app.services.assessment_export.save_workflow_state")
async def test_resolve_writeup_iterates_when_fingerprint_changes(_save):
    assessment = StakeholderAssessment()
    confirmed = {
        "categories": {"status": "confirmed", "data": {"items": [{"id": "c1", "content": {"label": "Gov"}}]}},
        "stakeholders": {
            "status": "confirmed",
            "data": {"items": [{"id": "s1", "content": {"name": "Mayor", "category": "Gov"}}]},
        },
        "stakeholder_details": {"data": {"records": {}}},
    }
    state = {
        "stages": confirmed,
        "cached_exports": {
            "writeup": {
                "content": {"title": "Old", "executive_summary": "Prior"},
                "fingerprint": "stale-fingerprint",
                "invalidated": False,
            }
        },
    }
    inst = _make_inst(state)
    db = AsyncMock()

    assessment.prepare_export_enrichment = AsyncMock(return_value=(confirmed, False))
    assessment.generate_writeup_content = AsyncMock(
        return_value={"title": "Revised", "executive_summary": "Updated"}
    )

    content, _ = await resolve_writeup_content(
        assessment=assessment,
        inst=inst,
        state=state,
        confirmed_stages=confirmed,
        context={"project_title": "Test"},
        db=db,
    )
    assert content["title"] == "Revised"
    call_kwargs = assessment.generate_writeup_content.await_args.kwargs
    assert call_kwargs["previous_content"]["title"] == "Old"
    assert call_kwargs["change_summary"]
    assert state["cached_exports"]["writeup"]["fingerprint"] == assessment.export_input_fingerprint(
        confirmed, state
    )


def test_stakeholder_fingerprint_includes_details():
    assessment = StakeholderAssessment()
    stages = {
        "stakeholders": {"data": {"items": [{"id": "s1", "content": {"name": "A"}}]}},
        "stakeholder_details": {
            "data": {"records": {"s1": {"role_in_project": "Lead", "influence_level": "High"}}}
        },
    }
    fp1 = assessment.export_input_fingerprint(stages, {})
    stages2 = {
        **stages,
        "stakeholder_details": {
            "data": {"records": {"s1": {"role_in_project": "Lead", "influence_level": "Low"}}}
        },
    }
    assert fp1 != assessment.export_input_fingerprint(stages2, {})


def test_landscape_deep_dive_complete_helper():
    # Completeness requires citation-era cache shape (summary_citations present).
    assert LandscapeMappingAssessment._is_map_deep_dive_complete(
        {"what_this_is": ["An overview."], "summary_citations": [[]]}
    )
    assert not LandscapeMappingAssessment._is_map_deep_dive_complete(
        {"what_this_is": ["An overview."]}
    )
    assert not LandscapeMappingAssessment._is_map_deep_dive_complete({"what_this_is": []})
    assert not LandscapeMappingAssessment._is_map_deep_dive_complete({})


def test_supports_cached_writeup_for_narrative_modules():
    assert StakeholderAssessment().supports_cached_writeup() is True
    assert LandscapeMappingAssessment().supports_cached_writeup() is True
