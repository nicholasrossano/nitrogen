"""Carbon Emissions Calculator API — recalculate, sensitivity, and Excel export."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Any
import io
import logging

from app.core.database import get_db
from app.core.auth import get_current_user, MockUser
from app.tools.carbon_tool import CarbonTool
from app.services.carbon_engine import CarbonEngine, CarbonInput

router = APIRouter()
logger = logging.getLogger(__name__)


class RecalculateRequest(BaseModel):
    inputs: dict[str, dict[str, Any]]


class SensitivityRequest(BaseModel):
    inputs: dict[str, dict[str, Any]]
    params: list[str] | None = None
    delta: float = 0.20


class UpdateInputRequest(BaseModel):
    inputs: dict[str, dict[str, Any]]
    field_name: str
    value: Any
    source: str = "user"
    status: str = "confirmed"


@router.post("/carbon/recalculate")
async def recalculate_carbon(
    data: RecalculateRequest,
    user: MockUser = Depends(get_current_user),
):
    """Recalculate carbon ERs from a full input set. No LLM call — pure math."""
    tool = CarbonTool()
    try:
        result = await tool.recalculate(data.inputs)
        return result
    except (ValueError, ZeroDivisionError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/carbon/update-input")
async def update_input_and_recalculate(
    data: UpdateInputRequest,
    user: MockUser = Depends(get_current_user),
):
    """Update a single input field and recalculate."""
    inputs = data.inputs
    if data.field_name in inputs:
        inputs[data.field_name]["value"] = data.value
        inputs[data.field_name]["source"] = data.source
        inputs[data.field_name]["status"] = data.status
    else:
        inputs[data.field_name] = {
            "field_name": data.field_name,
            "label": data.field_name,
            "value": data.value,
            "unit": "",
            "source": data.source,
            "status": data.status,
            "applies_to": "general",
            "notes": "",
            "rationale": "",
            "category": "general",
        }

    tool = CarbonTool()
    try:
        result = await tool.recalculate(inputs)
        return result
    except (ValueError, ZeroDivisionError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/carbon/sensitivity")
async def run_sensitivity(
    data: SensitivityRequest,
    user: MockUser = Depends(get_current_user),
):
    """Run sensitivity analysis on the carbon model."""
    engine_inputs = {k: CarbonInput.from_dict(v) for k, v in data.inputs.items()}
    try:
        points = CarbonEngine.run_sensitivity(
            engine_inputs,
            params=data.params,
            delta=data.delta,
        )
        return {"sensitivity": [p.to_dict() for p in points]}
    except (ValueError, ZeroDivisionError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/carbon/export")
async def export_carbon_excel(
    data: RecalculateRequest,
    user: MockUser = Depends(get_current_user),
):
    """Export the carbon model as an Excel file."""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Border, Side
    except ImportError:
        raise HTTPException(status_code=500, detail="openpyxl not installed")

    engine_inputs = {k: CarbonInput.from_dict(v) for k, v in data.inputs.items()}

    if not CarbonEngine.is_computable(engine_inputs):
        raise HTTPException(status_code=400, detail="Not enough inputs to compute emission reductions")

    try:
        result = CarbonEngine.calculate(engine_inputs)
    except (ValueError, ZeroDivisionError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    wb = openpyxl.Workbook()

    header_font_white = Font(bold=True, size=11, color="FFFFFF")
    header_fill = PatternFill(start_color="1B5E20", end_color="1B5E20", fill_type="solid")
    assumed_fill = PatternFill(start_color="FFF3CD", end_color="FFF3CD", fill_type="solid")
    thin_border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin"),
    )

    # --- Inputs sheet ---
    ws_inputs = wb.active
    ws_inputs.title = "Inputs"
    headers = ["Field", "Value", "Unit", "Applies To", "Source", "Status", "Notes"]
    for col, h in enumerate(headers, 1):
        cell = ws_inputs.cell(row=1, column=col, value=h)
        cell.font = header_font_white
        cell.fill = header_fill
        cell.border = thin_border

    for row_idx, inp_data in enumerate(data.inputs.values(), 2):
        vals = [
            inp_data.get("label", inp_data.get("field_name", "")),
            inp_data.get("value", ""),
            inp_data.get("unit", ""),
            inp_data.get("applies_to", ""),
            inp_data.get("source", ""),
            inp_data.get("status", ""),
            inp_data.get("notes", ""),
        ]
        for col, v in enumerate(vals, 1):
            cell = ws_inputs.cell(row=row_idx, column=col, value=v)
            cell.border = thin_border
            if inp_data.get("status") == "assumed":
                cell.fill = assumed_fill

    for col in range(1, 8):
        ws_inputs.column_dimensions[chr(64 + col)].width = 22

    # --- Summary sheet ---
    ws_summary = wb.create_sheet("Summary")
    summary_rows = [
        ("Baseline Emissions", f"{result.baseline_emissions_tco2e:,.4f} tCO₂e"),
        ("Project Emissions", f"{result.project_emissions_tco2e:,.4f} tCO₂e"),
        ("Leakage", f"{result.leakage_tco2e:,.4f} tCO₂e"),
        ("Net Emission Reductions", f"{result.net_er_tco2e:,.4f} tCO₂e"),
        ("Period", result.period),
        ("Crediting Period", f"{result.period_years} years"),
        ("Assumptions Used", str(result.assumption_count)),
        ("Estimate Quality", result.quality_label),
    ]
    for col, h in enumerate(["Metric", "Value"], 1):
        cell = ws_summary.cell(row=1, column=col, value=h)
        cell.font = header_font_white
        cell.fill = header_fill
        cell.border = thin_border
    for row_idx, (metric, value) in enumerate(summary_rows, 2):
        ws_summary.cell(row=row_idx, column=1, value=metric).border = thin_border
        ws_summary.cell(row=row_idx, column=2, value=value).border = thin_border
    ws_summary.column_dimensions["A"].width = 28
    ws_summary.column_dimensions["B"].width = 30

    # --- ER Schedule sheet ---
    ws_er = wb.create_sheet("ER Schedule")
    er_headers = [
        "Year", "Devices Active", "Baseline Emissions (tCO₂e)",
        "Project Emissions (tCO₂e)", "Leakage (tCO₂e)", "Net ERs (tCO₂e)",
    ]
    for col, h in enumerate(er_headers, 1):
        cell = ws_er.cell(row=1, column=col, value=h)
        cell.font = header_font_white
        cell.fill = header_fill
        cell.border = thin_border
    for row_idx, row in enumerate(result.er_schedule, 2):
        vals = [
            row.year, row.devices_active, row.baseline_emissions,
            row.project_emissions, row.leakage, row.net_er,
        ]
        for col, v in enumerate(vals, 1):
            cell = ws_er.cell(row=row_idx, column=col, value=v)
            cell.border = thin_border
    for col in range(1, 7):
        ws_er.column_dimensions[chr(64 + col)].width = 24

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=carbon_er_model.xlsx"},
    )
