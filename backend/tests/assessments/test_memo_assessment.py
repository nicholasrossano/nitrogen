"""Tests for the memo staged assessment."""

import pytest

from app.assessments import get_assessment_registry
from app.assessments.utils import make_build_item
from app.domain.energy.assessments.memo import (
    DEFAULT_MEMO_SECTIONS,
    MemoAssessment,
)


def test_memo_registered_and_stage_flow():
    registry = get_assessment_registry()
    assessment = registry.get_assessment("memo")
    assert assessment is not None
    assert isinstance(assessment, MemoAssessment)
    assert [stage.id for stage in assessment.stage_defs] == ["sections", "drafts"]
    assert assessment.definition.export_format == "docx"
    assert assessment.manifest.evidence_behavior == "rag_grounded"
    assert "risk_assessment" in assessment.manifest.input_dependencies
    assert assessment.manifest.produced_outputs == ["memo", "memo_citations"]


@pytest.mark.asyncio
async def test_generate_outline_falls_back_to_defaults(monkeypatch):
    assessment = MemoAssessment()

    async def fake_synthesis(_context):
        return {"prompt_text": "synthesis", "sources_used": [], "sources_missing": ["risk_assessment"]}

    async def fake_llm_json(**_kwargs):
        return {"sections": []}

    monkeypatch.setattr(assessment, "_synthesis_pack", fake_synthesis)
    monkeypatch.setattr(
        "app.domain.energy.assessments.memo.llm_json",
        fake_llm_json,
    )

    items = await assessment.generate_items_for_stage(
        "sections",
        "seed_from_template",
        {"project_title": "Pilot"},
        {},
    )
    assert len(items) == len(DEFAULT_MEMO_SECTIONS)
    assert items[0]["section_key"] == "executive_summary"
    assert items[-1]["section_key"] == "open_questions"


@pytest.mark.asyncio
async def test_generate_outline_adapts_and_keeps_core_sections(monkeypatch):
    assessment = MemoAssessment()

    async def fake_synthesis(_context):
        return {"prompt_text": "", "sources_used": [], "sources_missing": []}

    async def fake_llm_json(**_kwargs):
        return {
            "sections": [
                {
                    "section_key": "executive_summary",
                    "label": "Executive Summary",
                    "description": "Adapted overview",
                    "key_points": "Ask; impact; recommendation",
                },
                {
                    "section_key": "recommendation",
                    "label": "Recommendation",
                    "description": "Decision",
                    "key_points": "proceed/hold/reject",
                },
                # Intentionally omit other core sections — implementation should restore them.
            ]
        }

    monkeypatch.setattr(assessment, "_synthesis_pack", fake_synthesis)
    monkeypatch.setattr(
        "app.domain.energy.assessments.memo.llm_json",
        fake_llm_json,
    )

    items = await assessment.generate_items_for_stage(
        "sections",
        "seed_from_template",
        {"project_title": "Pilot"},
        {},
    )
    keys = {item["section_key"] for item in items}
    assert "executive_summary" in keys
    assert "open_questions" in keys
    assert "risks_and_assumptions" in keys
    exec_row = next(i for i in items if i["section_key"] == "executive_summary")
    assert exec_row["description"] == "Adapted overview"


@pytest.mark.asyncio
async def test_generate_drafts_maps_to_outline_categories(monkeypatch):
    assessment = MemoAssessment()
    sections = [
        make_build_item(
            {
                "section_key": "recommendation",
                "label": "Recommendation",
                "description": "Decision",
                "key_points": "proceed/hold/reject",
            }
        ),
        make_build_item(
            {
                "section_key": "open_questions",
                "label": "Open Questions",
                "description": "Gaps",
                "key_points": "missing assessments",
            }
        ),
    ]

    async def fake_synthesis(_context):
        return {
            "prompt_text": "Missing: Risk Assessment",
            "sources_used": [],
            "sources_missing": ["risk_assessment"],
        }

    async def fake_evidence(_context):
        return ("\n\nRetrieved sources…\n[1] Example", [{"number": 1, "source_title": "Example"}])

    async def fake_llm_json(**_kwargs):
        return {
            "drafts": [
                {
                    "section_key": "recommendation",
                    "title": "Recommendation",
                    "body": "Hold pending risk register. [1]",
                    "recommendation": "hold",
                    "confidence": "medium",
                },
                {
                    "section_key": "open_questions",
                    "title": "Open Questions",
                    "body": "Complete risk assessment before proceeding.",
                },
            ]
        }

    monkeypatch.setattr(assessment, "_synthesis_pack", fake_synthesis)
    monkeypatch.setattr(assessment, "_evidence_for_memo", fake_evidence)
    monkeypatch.setattr(
        "app.domain.energy.assessments.memo.llm_json",
        fake_llm_json,
    )

    drafts = await assessment.generate_items_for_stage(
        "drafts",
        "propose_with_ai",
        {"project_title": "Pilot", "geography": "Kenya"},
        {"sections": {"data": {"items": sections}}},
    )
    assert len(drafts) == 2
    rec = next(d for d in drafts if d["section_key"] == "recommendation")
    assert rec["category"] == "Recommendation"
    assert rec["recommendation"] == "hold"
    assert "Hold" in rec["body"]


@pytest.mark.asyncio
async def test_generate_writeup_assembles_from_confirmed_drafts(monkeypatch):
    assessment = MemoAssessment()
    drafts = [
        make_build_item(
            {
                "section_key": "executive_summary",
                "title": "Executive Summary",
                "category": "Executive Summary",
                "body": "Pilot overview and hold recommendation.",
            }
        ),
        make_build_item(
            {
                "section_key": "recommendation",
                "title": "Recommendation",
                "category": "Recommendation",
                "body": "Hold pending diligence.",
                "recommendation": "hold",
                "confidence": "medium",
            }
        ),
    ]

    async def fake_synthesis(_context):
        return {
            "prompt_text": "",
            "sources_used": ["stakeholder_assessment"],
            "sources_missing": ["risk_assessment"],
        }

    async def fake_evidence(_context):
        return ("", [{"number": 1, "source_title": "Doc A"}])

    async def fake_llm_json(**_kwargs):
        return {
            "title": "memo — Pilot",
            "executive_summary": "Hold pending risk work.",
            "recommendation": "hold",
            "confidence": "medium",
            "sections": [
                {"theme": "Recommendation", "body": "Hold pending diligence."},
                {"theme": "Rationale", "body": "Stakeholder map is strong; risk register missing."},
            ],
        }

    monkeypatch.setattr(assessment, "_synthesis_pack", fake_synthesis)
    monkeypatch.setattr(assessment, "_evidence_for_memo", fake_evidence)
    monkeypatch.setattr(
        "app.domain.energy.assessments.memo.llm_json",
        fake_llm_json,
    )

    content = await assessment.generate_writeup_content(
        {
            "sections": {"data": {"items": []}},
            "drafts": {"data": {"items": drafts}},
        },
        {"project_title": "Pilot"},
    )
    assert content["recommendation"] == "hold"
    assert content["citations"][0]["source_title"] == "Doc A"
    assert "risk_assessment" in content["sources_missing"]
    assert content["sections"]
