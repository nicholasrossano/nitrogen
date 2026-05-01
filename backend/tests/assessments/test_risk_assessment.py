from io import BytesIO

import openpyxl
import pytest

from app.assessments.risk_assessment import RiskAssessment
from app.assessments.utils import make_build_item


def test_risk_assessment_stage_defs_follow_expected_flow():
    assessment = RiskAssessment()

    assert assessment.definition.id == "risk_assessment"
    assert assessment.definition.export_format == "xlsx"
    assert [stage.id for stage in assessment.stage_defs] == [
        "categories",
        "risks",
        "mitigations",
        "results",
    ]
    assert assessment.stage_defs[-1].title == "Results"
    assert assessment.stage_defs[-1].widget == "risk_register_results"
    assert assessment.manifest.adapter_bindings == {"research_source": "retrieval"}
    assert assessment.manifest.produced_outputs == ["risk_register"]


@pytest.mark.asyncio
async def test_compute_stage_builds_register_and_normalizes_ratings(monkeypatch):
    assessment = RiskAssessment()
    category = make_build_item({
        "label": "Institutional Capacity",
        "description": "Implementing agency and partner capability.",
        "why_it_matters": "Several delivery partners are expected.",
    })
    risk = make_build_item({
        "title": "Multiple delivery channels may create coordination delays",
        "category": "Institutional Capacity",
        "description": "Grid, mini-grid, household systems, and clean cooking channels require coordination.",
        "affected_components": "Grid; mini-grid; household systems; clean cooking",
        "basis": "The project involves several technologies and likely implementation partners.",
        "missing_information": "Implementation roles and coordination arrangements are not yet documented.",
    })

    async def fake_rate_register(context, category_items, draft_register):
        return {
            "category_ratings": [{
                "category": "Institutional Capacity",
                "rating": "substantial",
                "rationale": "Coordination burden remains material.",
                "top_risks": ["Multiple delivery channels may create coordination delays"],
                "unresolved_issues": ["Implementation roles are not yet documented."],
            }],
            "risk_register": [{
                "risk_id": "R01",
                "inherent_rating": "High",
                "residual_rating": "moderate",
                "rating_rationale": "Mitigation reduces but does not eliminate coordination risk.",
                "basis_evidence": "Project has multiple delivery channels.",
                "missing_information": "Implementation roles and coordination arrangements are not yet documented.",
            }],
        }

    monkeypatch.setattr(assessment, "_rate_register", fake_rate_register)

    result = await assessment.compute_stage(
        "results",
        {
            "categories": {"data": {"items": [category]}},
            "risks": {"data": {"items": [risk]}},
            "mitigations": {
                "data": {
                    "records": {
                        risk["id"]: {
                            "mitigation": "Define agency roles and escalation protocols before launch.",
                            "owner": "Project team",
                            "timing": "Preparation",
                            "remaining_issue": "Partner capacity needs validation.",
                            "status": "Needs validation",
                        }
                    }
                }
            },
        },
        {"project_title": "Energy Access Project"},
    )

    row = result["risk_register"][0]
    assert row["risk_id"] == "R01"
    assert row["category"] == "Institutional Capacity"
    assert row["inherent_rating"] == "High"
    assert row["residual_rating"] == "Moderate"
    assert row["mitigation"] == "Define agency roles and escalation protocols before launch."
    assert result["category_ratings"][0]["rating"] == "Substantial"
    assert "Risk ID" in result["copy"]["markdown"]
    assert "risk_id" in result["copy"]["tsv"]


def test_export_xlsx_includes_register_sheets():
    assessment = RiskAssessment()
    workbook_bytes = assessment.export_xlsx({
        "risk_register": [{
            "risk_id": "R01",
            "category": "Technical Design",
            "risk_title": "Design assumptions may not match site conditions",
            "description": "Engineering inputs need validation.",
            "affected_components": "System design",
            "inherent_rating": "Substantial",
            "mitigation": "Complete site validation before procurement.",
            "residual_rating": "Moderate",
            "owner_status": "Project team / Needs validation",
            "basis_evidence": "Project materials reference early-stage design.",
            "missing_information": "Final site survey.",
            "rating_rationale": "Residual risk remains until survey is complete.",
        }],
        "category_ratings": [{
            "category": "Technical Design",
            "rating": "Moderate",
            "rationale": "Site validation can reduce risk.",
        }],
        "top_risks": [{
            "risk_id": "R01",
            "risk_title": "Design assumptions may not match site conditions",
            "why_it_matters": "Procurement could be mis-specified.",
            "mitigation_summary": "Complete site validation.",
        }],
        "unresolved_issues": [{
            "risk_id": "R01",
            "issue": "Final site survey.",
        }],
    })

    workbook = openpyxl.load_workbook(BytesIO(workbook_bytes))
    assert workbook.sheetnames == [
        "Risk Register",
        "Category Ratings",
        "Top Risks",
        "Unresolved Issues",
    ]
    register = workbook["Risk Register"]
    assert register["A1"].value == "Risk ID"
    assert register["A2"].value == "R01"
    assert register["H2"].value == "Moderate"


@pytest.mark.asyncio
async def test_bulk_mitigation_generation_populates_each_risk(monkeypatch):
    assessment = RiskAssessment()
    risk_item = make_build_item({
        "title": "Fragmented beneficiary and site data could weaken targeting and implementation planning.",
        "category": "Data Quality and Results Verification",
        "affected_components": "Beneficiary targeting; site prioritization",
        "why_it_matters": "The project depends on credible data to choose sites and beneficiaries.",
        "evidence_basis": "Project context references geospatial analysis and site planning.",
        "missing_information": "Data owners and QA process are not documented.",
    })

    async def fake_llm_json(*args, **kwargs):
        return {
            "mitigations": [{
                "source_item_id": risk_item["id"],
                "mitigation": "Define a data dictionary and QA workflow before site prioritization is finalized.",
                "owner": "Project data lead",
                "timing": "Preparation",
                "remaining_issue": "Data-sharing authority is still unconfirmed.",
                "status": "Needs validation",
            }]
        }

    monkeypatch.setattr("app.assessments.risk_assessment.llm_json", fake_llm_json)

    records = await assessment.enrich_records_for_stage(
        "mitigations",
        [risk_item],
        {},
        {
            "project_title": "Malawi Energy Access Project",
            "project_type": "energy_access",
            "geography": "Malawi",
            "project_description": "Uses geospatial analysis for energy access site prioritization.",
        },
    )

    assert risk_item["id"] in records
    assert records[risk_item["id"]]["mitigation"].startswith("Define a data dictionary")
    assert records[risk_item["id"]]["owner"] == "Project data lead"


@pytest.mark.asyncio
async def test_generate_risks_falls_back_to_concrete_category_specific_rows(monkeypatch):
    assessment = RiskAssessment()
    categories = [
        make_build_item({
            "label": "Sector Policy and Regulatory",
            "description": "Rules and permits",
            "why_it_matters": "Project depends on policy approvals.",
            "status": "Include",
        }),
        make_build_item({
            "label": "Technical Design and Delivery",
            "description": "Engineering and integration",
            "why_it_matters": "Delivery complexity is high.",
            "status": "Include",
        }),
    ]

    async def fake_llm_json(*args, **kwargs):
        return {"risks": []}

    monkeypatch.setattr("app.assessments.risk_assessment.llm_json", fake_llm_json)

    risks = await assessment._generate_risks(
        {
            "project_type": "energy_access",
            "geography": "Kenya",
            "project_description": "Distributed energy rollout",
        },
        categories,
    )

    assert len(risks) >= 4
    titles = [risk["title"].lower() for risk in risks]
    assert not any("assumptions need validation" in title for title in titles)
    assert not any("category-specific execution risk" in title for title in titles)
    assert any("permitting" in title or "approval" in title for title in titles)
    assert any("design assumptions" in title or "integration" in title for title in titles)
