"""Tests for the Memo staged assessment (risk summary, not an investment recommendation)."""

import pytest

from app.assessments import get_assessment_registry
from app.assessments.utils import make_build_item
from app.domain.energy.assessments.memo_assessment import (
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


def test_memo_drafts_stage_has_no_recommendation_field():
    """This memo summarizes risk; it must never carry a proceed/hold/reject field."""
    assessment = MemoAssessment()
    drafts_stage = next(stage for stage in assessment.stage_defs if stage.id == "drafts")
    field_names = {field.name for field in drafts_stage.fields}
    assert "recommendation" not in field_names
    assert "confidence" not in field_names


@pytest.mark.asyncio
async def test_generate_outline_falls_back_to_defaults(monkeypatch):
    assessment = MemoAssessment()

    async def fake_synthesis(_context):
        return {"prompt_text": "synthesis", "sources_used": [], "sources_missing": ["risk_assessment"]}

    async def fake_llm_json(**_kwargs):
        return {"sections": []}

    monkeypatch.setattr(assessment, "_synthesis_pack", fake_synthesis)
    monkeypatch.setattr(
        "app.domain.energy.assessments.memo_assessment.llm_json",
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
                    "key_points": "Ask; context; overall risk posture",
                },
                {
                    "section_key": "risk_summary",
                    "label": "Risk Summary",
                    "description": "Key risks",
                    "key_points": "technical; financial; operational",
                },
                # Intentionally omit other core sections — implementation should restore them.
            ]
        }

    monkeypatch.setattr(assessment, "_synthesis_pack", fake_synthesis)
    monkeypatch.setattr(
        "app.domain.energy.assessments.memo_assessment.llm_json",
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
    assert "evidence_summary" in keys
    exec_row = next(i for i in items if i["section_key"] == "executive_summary")
    assert exec_row["description"] == "Adapted overview"


@pytest.mark.asyncio
async def test_generate_drafts_maps_to_outline_categories(monkeypatch):
    assessment = MemoAssessment()
    sections = [
        make_build_item(
            {
                "section_key": "risk_summary",
                "label": "Risk Summary",
                "description": "Key risks",
                "key_points": "technical; financial; operational",
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
                    "section_key": "risk_summary",
                    "title": "Risk Summary",
                    "body": "Key technical and financial risks pending the risk register. [1]",
                },
                {
                    "section_key": "open_questions",
                    "title": "Open Questions",
                    "body": "Complete risk assessment for a full picture.",
                },
            ]
        }

    monkeypatch.setattr(assessment, "_synthesis_pack", fake_synthesis)
    monkeypatch.setattr(assessment, "_evidence_for_memo", fake_evidence)
    monkeypatch.setattr(
        "app.domain.energy.assessments.memo_assessment.llm_json",
        fake_llm_json,
    )

    drafts = await assessment.generate_items_for_stage(
        "drafts",
        "propose_with_ai",
        {"project_title": "Pilot", "geography": "Kenya"},
        {"sections": {"data": {"items": sections}}},
    )
    assert len(drafts) == 2
    risk_row = next(d for d in drafts if d["section_key"] == "risk_summary")
    assert risk_row["category"] == "Risk Summary"
    assert "recommendation" not in risk_row
    assert "confidence" not in risk_row
    assert "technical" in risk_row["body"]


@pytest.mark.asyncio
async def test_generate_writeup_assembles_from_confirmed_drafts_without_recommendation(monkeypatch):
    assessment = MemoAssessment()
    drafts = [
        make_build_item(
            {
                "section_key": "executive_summary",
                "title": "Executive Summary",
                "category": "Executive Summary",
                "body": "Pilot overview and risk posture.",
            }
        ),
        make_build_item(
            {
                "section_key": "risk_summary",
                "title": "Risk Summary",
                "category": "Risk Summary",
                "body": "Key risks pending diligence.",
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
            "title": "Memo — Pilot",
            "executive_summary": "Overview of risk posture pending diligence.",
            "sections": [
                {"theme": "Risk Summary", "body": "Key risks pending diligence."},
                {"theme": "Evidence", "body": "Stakeholder map is strong; risk register missing."},
            ],
        }

    monkeypatch.setattr(assessment, "_synthesis_pack", fake_synthesis)
    monkeypatch.setattr(assessment, "_evidence_for_memo", fake_evidence)
    monkeypatch.setattr(
        "app.domain.energy.assessments.memo_assessment.llm_json",
        fake_llm_json,
    )

    content = await assessment.generate_writeup_content(
        {
            "sections": {"data": {"items": []}},
            "drafts": {"data": {"items": drafts}},
        },
        {"project_title": "Pilot"},
    )
    assert "recommendation" not in content
    assert "confidence" not in content
    assert content["citations"][0]["source_title"] == "Doc A"
    assert "risk_assessment" in content["sources_missing"]
    assert content["sections"]
