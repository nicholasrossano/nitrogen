from io import BytesIO

import openpyxl

from app.modules.lcoe_module import LCOETool
from app.modules.stakeholder_assessment import StakeholderAssessmentModule
from app.services.decision_log_service import (
    build_current_state_rows,
    build_decision_log_xlsx,
)


def test_build_current_state_rows_includes_provenance_and_final_approval():
    module = StakeholderAssessmentModule()
    workflow_state = {
        "module_type": module.definition.id,
        "current_stage_id": "stakeholders",
        "final_approval": {
            "status": "approved",
            "approved_at": "2026-04-17T15:00:00+00:00",
            "approved_by": "user-1",
            "approved_by_email": "owner@example.com",
        },
        "stages": {
            "categories": {
                "status": "confirmed",
                "confirmed_at": "2026-04-17T14:00:00+00:00",
                "confirmed_by": "reviewer-1",
                "confirmed_by_email": "reviewer@example.com",
                "data": {
                    "items": [
                        {
                            "id": "item-internal",
                            "content": {"name": "Permitting", "category": "Regulatory"},
                            "origin": "inferred",
                            "provenance": {
                                "derivation": "inferred",
                                "sources": [
                                    {
                                        "source_type": "evidence",
                                        "source_title": "Project brief.pdf",
                                    }
                                ],
                            },
                        },
                        {
                            "id": "item-user",
                            "content": {"name": "Community outreach", "category": "Stakeholder"},
                            "origin": "provided",
                            "provenance": {"derivation": "provided", "sources": []},
                        },
                    ]
                },
            }
        },
    }

    rows = build_current_state_rows(
        workflow_state=workflow_state,
        stage_defs=module.stage_defs,
        module_id=module.definition.id,
        module_name=module.definition.name,
        module_instance_id="instance-1",
    )

    assert rows
    assert any(row["source_type"] == "Internal Materials" for row in rows)
    assert any(row["source_type"] == "User Input" for row in rows)
    assert all(row["final_approved_by"] == "owner@example.com" for row in rows)
    assert any(row["item"] == "Permitting" and row["current_value"] == "Permitting" for row in rows)
    assert all(row["confirmed_by"] == "reviewer@example.com" for row in rows)


def test_build_decision_log_xlsx_writes_current_and_history_sheets():
    report = {
        "metadata": {},
        "current_rows": [
            {
                "module": "Stakeholder Assessment",
                "module_id": "stakeholder_assessment",
                "module_instance_id": "instance-1",
                "stage": "Categories",
                "stage_id": "categories",
                "entity_type": "item",
                "entity_id": "item-1",
                "item": "Permitting",
                "field": "Category",
                "current_value": "Regulatory",
                "source_type": "Internal Materials",
                "source_detail": "Project brief.pdf",
                "status": "confirmed",
                "confirmed_by": "reviewer-1",
                "confirmed_at": "17 Apr 2026 14:00 UTC",
                "final_approved_by": "owner@example.com",
                "final_approved_at": "17 Apr 2026 15:00 UTC",
            }
        ],
        "history_rows": [
            {
                "module_id": "stakeholder_assessment",
                "module_instance_id": "instance-1",
                "stage_id": "categories",
                "event": "Stage Confirmed",
                "entity_type": "Stage",
                "entity_id": "categories",
                "actor": "owner@example.com",
                "occurred_at": "17 Apr 2026 14:00 UTC",
                "details": "confirmed_at: 2026-04-17T14:00:00+00:00",
            }
        ],
    }

    workbook_bytes = build_decision_log_xlsx(report)
    workbook = openpyxl.load_workbook(BytesIO(workbook_bytes))

    assert workbook.sheetnames == ["Current State", "History"]
    assert workbook["Current State"]["A2"].value == "Stakeholder Assessment"
    assert workbook["History"]["A2"].value == "stakeholder_assessment"


def test_build_current_state_rows_summarizes_computed_widget_to_overview_metrics():
    module = LCOETool()
    workflow_state = {
        "module_type": module.definition.id,
        "current_stage_id": "results",
        "final_approval": {
            "status": "approved",
            "approved_at": "2026-04-17T15:00:00+00:00",
            "approved_by": "user-1",
            "approved_by_email": "owner@example.com",
        },
        "stages": {
            "results": {
                "status": "confirmed",
                "confirmed_at": "2026-04-17T14:00:00+00:00",
                "confirmed_by": "reviewer-1",
                "confirmed_by_email": "reviewer@example.com",
                "data": {
                    "widget_data": {
                        "inputs": {
                            "currency": {"value": "USD"},
                        },
                        "result": {
                            "currency": "USD",
                            "lcoe": 0.2253,
                            "npv_total_costs": 606748,
                            "npv_total_energy": 2693484,
                            "lifetime_energy_kwh": 6190504,
                            "assumption_count": 4,
                            "quality_label": "moderate",
                        },
                    }
                },
            }
        },
    }

    rows = build_current_state_rows(
        workflow_state=workflow_state,
        stage_defs=module.stage_defs,
        module_id=module.definition.id,
        module_name=module.definition.name,
        module_instance_id="instance-1",
    )

    assert rows
    assert any(row["item"] == "LCOE" and "USD 0.2253" in row["current_value"] for row in rows)
    assert any(row["item"] == "Discounted Costs (NPV)" for row in rows)
    assert all("Inputs /" not in row["item"] for row in rows)
    assert all(row["source_type"] == "Computed Value" for row in rows)
    assert all("Nitrogen LCOE engine" in row["source_detail"] for row in rows)
