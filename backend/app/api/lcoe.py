"""LCOE API endpoints — recalculate, sensitivity, and Excel export."""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from uuid import UUID
from typing import Any
import io
import logging

from app.core.database import get_db
from app.core.auth import get_current_user, MockUser
from app.tools.lcoe_tool import LCOETool
from app.services.lcoe_engine import LCOEEngine, LCOEInput

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


@router.post("/lcoe/recalculate")
async def recalculate_lcoe(
    data: RecalculateRequest,
    user: MockUser = Depends(get_current_user),
):
    """Recalculate LCOE from a full input set. No LLM call — pure math."""
    tool = LCOETool()
    try:
        result = await tool.recalculate(data.inputs)
        return result
    except (ValueError, ZeroDivisionError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/lcoe/update-input")
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
            "notes": "",
            "rationale": "",
            "category": "general",
        }

    tool = LCOETool()
    try:
        result = await tool.recalculate(inputs)
        return result
    except (ValueError, ZeroDivisionError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/lcoe/sensitivity")
async def run_sensitivity(
    data: SensitivityRequest,
    user: MockUser = Depends(get_current_user),
):
    """Run sensitivity analysis on the LCOE model."""
    engine_inputs = {k: LCOEInput.from_dict(v) for k, v in data.inputs.items()}
    try:
        points = LCOEEngine.run_sensitivity(
            engine_inputs,
            params=data.params,
            delta=data.delta,
        )
        return {"sensitivity": [p.to_dict() for p in points]}
    except (ValueError, ZeroDivisionError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/lcoe/export")
async def export_lcoe_excel(
    data: RecalculateRequest,
    user: MockUser = Depends(get_current_user),
):
    """Export the LCOE model as an Excel file."""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    except ImportError:
        raise HTTPException(status_code=500, detail="openpyxl not installed")

    engine_inputs = {k: LCOEInput.from_dict(v) for k, v in data.inputs.items()}

    if not LCOEEngine.is_computable(engine_inputs):
        raise HTTPException(status_code=400, detail="Not enough inputs to compute LCOE")

    try:
        result = LCOEEngine.calculate(engine_inputs)
    except (ValueError, ZeroDivisionError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    wb = openpyxl.Workbook()

    header_font = Font(bold=True, size=11)
    header_fill = PatternFill(start_color="004D91", end_color="004D91", fill_type="solid")
    header_font_white = Font(bold=True, size=11, color="FFFFFF")
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
    headers = ["Field", "Value", "Unit", "Source", "Status", "Notes"]
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
            inp_data.get("source", ""),
            inp_data.get("status", ""),
            inp_data.get("notes", ""),
        ]
        for col, v in enumerate(vals, 1):
            cell = ws_inputs.cell(row=row_idx, column=col, value=v)
            cell.border = thin_border
            if inp_data.get("status") == "assumed":
                cell.fill = assumed_fill

    for col in range(1, 7):
        ws_inputs.column_dimensions[chr(64 + col)].width = 20

    # --- Summary sheet ---
    ws_summary = wb.create_sheet("Summary")
    summary_rows = [
        ("LCOE", f"{result.currency} {result.lcoe:.6f}/kWh"),
        ("NPV Total Costs", f"{result.currency} {result.npv_total_costs:,.2f}"),
        ("NPV Total Energy", f"{result.npv_total_energy:,.2f} kWh"),
        ("CAPEX Share", f"{result.capex_share:.1%}"),
        ("O&M Share", f"{result.opex_share:.1%}"),
        ("Fuel Share", f"{result.fuel_share:.1%}"),
        ("Replacement Share", f"{result.replacement_share:.1%}"),
        ("Lifetime Energy", f"{result.lifetime_energy_kwh:,.0f} kWh"),
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
    ws_summary.column_dimensions["A"].width = 25
    ws_summary.column_dimensions["B"].width = 30

    # --- Cash Flows sheet ---
    ws_cf = wb.create_sheet("Cash Flows")
    cf_headers = [
        "Year", "CAPEX", "O&M", "Fuel", "Replacement",
        "Total Cost", "Energy (kWh)", "Discount Factor",
        "Discounted Cost", "Discounted Energy",
    ]
    for col, h in enumerate(cf_headers, 1):
        cell = ws_cf.cell(row=1, column=col, value=h)
        cell.font = header_font_white
        cell.fill = header_fill
        cell.border = thin_border
    for row_idx, cf in enumerate(result.cash_flows, 2):
        vals = [
            cf.year, cf.capex, cf.opex, cf.fuel, cf.replacement,
            cf.total_cost, cf.energy_kwh, cf.discount_factor,
            cf.discounted_cost, cf.discounted_energy,
        ]
        for col, v in enumerate(vals, 1):
            cell = ws_cf.cell(row=row_idx, column=col, value=v)
            cell.border = thin_border
    for col in range(1, 11):
        ws_cf.column_dimensions[chr(64 + col)].width = 16

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=lcoe_model.xlsx"},
    )
