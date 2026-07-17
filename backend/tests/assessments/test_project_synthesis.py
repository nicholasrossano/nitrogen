"""Unit tests for cross-assessment project synthesis context."""

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.assessments.project_synthesis import (
    SYNTHESIS_ASSESSMENT_IDS,
    _pick_best_instance,
    _summarize_workflow_state,
    build_project_synthesis_context,
    format_synthesis_for_prompt,
)


def _instance(
    *,
    assessment_id: str,
    approved: bool = False,
    confirmed_stages: dict | None = None,
    title: str | None = None,
    deliverable: dict | None = None,
):
    stages = {}
    for stage_id, items in (confirmed_stages or {}).items():
        stages[stage_id] = {
            "status": "confirmed",
            "data": {"items": items},
        }
    state = {"stages": stages}
    if approved:
        state["final_approval"] = {"status": "approved"}

    return SimpleNamespace(
        id=uuid4(),
        assessment_id=assessment_id,
        title=title,
        archived=False,
        workflow_state=state,
        deliverable=deliverable or {},
        updated_at=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
        is_plan_complete=approved,
        instance_number=1,
    )


def test_pick_best_instance_prefers_approved():
    draft = _instance(
        assessment_id="risk_assessment",
        confirmed_stages={
            "risks": [{"content": {"title": "A", "category": "Ops"}}],
        },
    )
    approved = _instance(
        assessment_id="risk_assessment",
        approved=True,
        confirmed_stages={
            "risks": [{"content": {"title": "B", "category": "Ops"}}],
        },
    )
    best = _pick_best_instance([draft, approved])
    assert best is approved


def test_summarize_risk_assessment_extracts_confirmed_risks():
    state = {
        "stages": {
            "risks": {
                "status": "confirmed",
                "data": {
                    "items": [
                        {
                            "content": {
                                "title": "Grid interconnection delay",
                                "category": "Technical",
                                "why_it_matters": "Delays revenue",
                                "evidence_status": "Supported",
                            }
                        }
                    ]
                },
            },
            "results": {
                "status": "confirmed",
                "data": {
                    "widget_data": {
                        "top_risks": ["Grid interconnection delay"],
                        "unresolved_issues": ["PPA not signed"],
                    }
                },
            },
        }
    }
    summary = _summarize_workflow_state("risk_assessment", state)
    assert "Grid interconnection delay" in summary
    assert "PPA not signed" in summary


def test_format_synthesis_includes_missing_sources():
    pack = {
        "project_profile": {"title": "Pilot", "geography": "Kenya"},
        "assessments": [],
        "variables": {"examples": [{"label": "CAPEX", "value": "1M", "status": "validated"}]},
        "status": [],
        "project_plan_summary": "",
        "sources_used": [],
        "sources_missing": ["risk_assessment", "stakeholder_assessment"],
    }
    text = format_synthesis_for_prompt(pack)
    assert "CAPEX" in text
    assert "Risk Assessment" in text
    assert "Stakeholder Assessment" in text


@pytest.mark.asyncio
async def test_build_project_synthesis_without_db_lists_all_missing():
    pack = await build_project_synthesis_context(
        None,
        None,
        initiative_context={
            "project_title": "Demo",
            "variables": [
                {"label": "Discount rate", "value": "10%", "status": "assumed"},
            ],
        },
    )
    assert pack["sources_missing"] == list(SYNTHESIS_ASSESSMENT_IDS)
    assert pack["variables"]["examples"][0]["label"] == "Discount rate"
    assert "Demo" in pack["prompt_text"] or "Discount rate" in pack["prompt_text"]


@pytest.mark.asyncio
async def test_build_project_synthesis_soft_consumes_confirmed_assessments():
    project_id = uuid4()
    risk = _instance(
        assessment_id="risk_assessment",
        approved=True,
        title="Risk Register",
        confirmed_stages={
            "risks": [
                {
                    "content": {
                        "title": "Currency risk",
                        "category": "Financial",
                        "why_it_matters": "Tariff in local currency",
                    }
                }
            ]
        },
    )
    # Confirmed but not approved stakeholder should still be consumed.
    stakeholder = _instance(
        assessment_id="stakeholder_assessment",
        approved=False,
        confirmed_stages={
            "stakeholders": [
                {
                    "content": {
                        "name": "Utility",
                        "category": "Government",
                        "why_they_matter": "Offtaker",
                    }
                }
            ]
        },
    )
    # No confirmed stages and not approved → missing.
    landscape = _instance(assessment_id="landscape_mapping")

    project = SimpleNamespace(
        id=project_id,
        title="Mini-grid Pilot",
        geography="Kenya",
        project_type="energy_access",
        stage="diligence",
        project_description="Rural solar mini-grid",
        goal="Electrify 500 HH",
        project_plan={"pillars": [{"label": "Capital", "items": [{"status": "complete"}, {"status": "open"}]}]},
        assessment_instances=[risk, stakeholder, landscape],
    )

    class _FakeResult:
        def scalars(self):
            return SimpleNamespace(all=lambda: [])

    class _FakeDb:
        async def get(self, model, pid):
            assert pid == project_id
            return project

        async def execute(self, *_args, **_kwargs):
            return _FakeResult()

    pack = await build_project_synthesis_context(
        _FakeDb(),
        project_id,
        initiative_context={"variables": [{"label": "CAPEX", "value": "$2M", "status": "validated"}]},
    )

    used = set(pack["sources_used"])
    missing = set(pack["sources_missing"])
    assert "risk_assessment" in used
    assert "stakeholder_assessment" in used
    assert "landscape_mapping" in missing
    assert any("Currency risk" in a["summary"] for a in pack["assessments"])
    assert "Capital" in pack["project_plan_summary"]
    assert "approved" in pack["prompt_text"].lower() or "Risk Register" in pack["prompt_text"]
