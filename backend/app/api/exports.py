from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from typing import Any
import re

from app.core.database import get_db
from app.core.auth import get_current_user, AuthUser
from app.core.permissions import require_project_viewer
from app.core.filename_utils import safe_content_disposition
from app.models.chat import CoreChat, CoreChatMessage
from app.domain.registry import build_export_handlers

router = APIRouter()


async def _handle_lcoe_export(content, safe_title, initiative, project_id, db, user):
    from app.domain.energy.api.lcoe import export_lcoe_excel, RecalculateRequest as LCOEReq
    inputs: dict[str, Any] = content.get("inputs") or {}
    if not inputs:
        inputs = await _recover_model_inputs(db, project_id, ("lcoe_output", "lcoe_inputs"))
    if not inputs:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="LCOE model inputs are not available for export. "
                   "Open the model in the chat and recalculate to refresh the data.",
        )
    return await export_lcoe_excel(data=LCOEReq(inputs=inputs), user=user)


async def _handle_carbon_export(content, safe_title, initiative, project_id, db, user):
    from app.domain.energy.api.carbon import export_carbon_excel, RecalculateRequest as CarbonReq
    inputs: dict[str, Any] = content.get("inputs") or {}
    if not inputs:
        inputs = await _recover_model_inputs(db, project_id, ("carbon_output", "carbon_inputs"))
    if not inputs:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Carbon model inputs are not available for export. "
                   "Open the model in the chat and recalculate to refresh the data.",
        )
    return await export_carbon_excel(data=CarbonReq(inputs=inputs), user=user)


async def _handle_solar_export(content, safe_title, initiative, project_id, db, user):
    from app.domain.energy.api.pvwatts import export_solar_excel, ExportRequest as SolarReq
    inputs: dict[str, Any] = content.get("inputs") or {}
    result: dict[str, Any] = content.get("result") or {}
    if not inputs or not result:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solar estimate data is not available for export. "
                   "Open the model in the chat and recalculate to refresh the data.",
        )
    return await export_solar_excel(data=SolarReq(inputs=inputs, result=result), user=user)


async def _handle_template_export(content, safe_title, initiative, project_id, db, user):
    from app.models.project_material import ProjectMaterial
    material_id = content.get("material_id") if isinstance(content, dict) else None
    if not material_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Template deliverable is missing the material reference.",
        )
    mat_result = await db.execute(
        select(ProjectMaterial).where(
            ProjectMaterial.id == UUID(material_id),
            ProjectMaterial.project_id == initiative.id,
        )
    )
    material = mat_result.scalar_one_or_none()
    if not material or not material.storage_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template file not found")
    from app.core.storage import get_uploads_storage
    storage = get_uploads_storage()
    file_bytes = await storage.load(material.storage_path)
    ext = material.filename.rsplit(".", 1)[-1] if "." in material.filename else "docx"
    mime = (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        if ext == "xlsx"
        else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    return Response(
        content=file_bytes,
        media_type=mime,
        headers={"Content-Disposition": safe_content_disposition(f"{safe_title}.{ext}")},
    )


_EXPORT_HANDLERS: dict[str, Any] = build_export_handlers({
    "lcoe": _handle_lcoe_export,
    "carbon": _handle_carbon_export,
    "solar": _handle_solar_export,
    "template": _handle_template_export,
})


@router.get("/projects/{project_id}/deliverables/{tool_id}/export")
async def export_deliverable(
    project_id: str,
    tool_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Export any generated deliverable to its native file format (DOCX or XLSX).

    Reads content directly from the DB so the frontend never needs to send
    input data back — avoids round-trip serialisation bugs.
    """
    initiative = await require_project_viewer(db, project_id, user)

    deliverables: dict[str, Any] = initiative.get_deliverables_dict()
    data = deliverables.get(tool_id)

    if data is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deliverable not found")

    output_type: str = data.get("output_type", "document")
    content: dict = data.get("content") or {}
    title: str = data.get("title", tool_id.replace("_", " ").title())
    safe_title = re.sub(r"[^\w\s\-.]", "_", title).replace(" ", "_")[:60]

    handler = _EXPORT_HANDLERS.get(output_type)
    if not handler:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Export not supported for output type: {output_type}",
        )
    return await handler(content, safe_title, initiative, initiative.id, db, user)


async def _recover_model_inputs(
    db: AsyncSession,
    project_id: UUID,
    widget_types: tuple[str, ...],
) -> dict[str, Any]:
    """Scan chat messages to find the most recent computable model inputs.

    Used as a fallback when the deliverable's stored inputs are stale or empty.
    """
    from sqlalchemy import and_
    result = await db.execute(
        select(CoreChatMessage)
        .join(CoreChat, CoreChat.id == CoreChatMessage.chat_id)
        .where(
            and_(
                CoreChat.project_id == project_id,
                CoreChatMessage.widget_type.in_(widget_types),
            )
        )
        .order_by(CoreChatMessage.created_at.desc())
    )
    messages = result.scalars().all()
    for msg in messages:
        wd = msg.widget_data or {}
        inputs = wd.get("inputs") or {}
        if inputs and wd.get("computable", False):
            return inputs
    # Last resort: return the largest set of inputs even if not computable
    best: dict[str, Any] = {}
    for msg in messages:
        wd = msg.widget_data or {}
        inputs = wd.get("inputs") or {}
        if len(inputs) > len(best):
            best = inputs
    return best
