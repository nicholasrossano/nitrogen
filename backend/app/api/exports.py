from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from pydantic import BaseModel
from typing import Any
import re

from app.core.database import get_db
from app.core.auth import get_current_user, AuthUser
from app.core.permissions import require_viewer
from app.core.storage import get_storage
from app.models.chat import ChatMessage
from app.models.memo import MemoVersion
from app.schemas.memo import ExportRequest, ExportResponse, MemoContent
from app.services.docx_exporter import DocxExporterService
from app.services.excel_exporter import ExcelExporterService

router = APIRouter()


class ChecklistExportRequest(BaseModel):
    content: dict  # The checklist content to export


@router.post("/initiatives/{initiative_id}/export", response_model=ExportResponse)
async def export_memo(
    initiative_id: UUID,
    data: ExportRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Export memo to DOCX"""
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        logger.info(f"Export request for initiative {initiative_id} by user {user.uid}")
        
        initiative = await require_viewer(db, initiative_id, user)
        
        # Get memo version
        if data.memo_version_id:
            memo_result = await db.execute(
                select(MemoVersion).where(
                    MemoVersion.id == data.memo_version_id,
                    MemoVersion.initiative_id == initiative_id,
                )
            )
        else:
            memo_result = await db.execute(
                select(MemoVersion)
                .where(MemoVersion.initiative_id == initiative_id)
                .order_by(MemoVersion.created_at.desc())
                .limit(1)
            )
        
        memo = memo_result.scalar_one_or_none()
        
        if not memo:
            logger.warning(f"No memo found for initiative {initiative_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No memo found to export",
            )
        
        logger.info(f"Found memo {memo.id} with keys: {list(memo.content.keys())}")
        
        # Generate DOCX - Handle both old flat structure and new sections structure
        exporter = DocxExporterService()
        
        # Check if memo uses new sections format
        if "sections" in memo.content:
            logger.info("Memo uses new sections format, generating with sections")
            docx_bytes = exporter.generate_from_sections(
                memo_content=memo.content,
                initiative_title=initiative.title or "Untitled Initiative",
            )
        else:
            logger.info("Memo uses legacy format, generating with MemoContent schema")
            memo_content = MemoContent(**memo.content)
            docx_bytes = exporter.generate(
                memo_content=memo_content,
                initiative_title=initiative.title or "Untitled Initiative",
            )
        
        logger.info(f"DOCX generated ({len(docx_bytes)} bytes), saving to storage...")
        
        # Save to storage
        storage = get_storage()
        filename = f"memo_{initiative.title or 'untitled'}_{memo.id}.docx".replace(" ", "_")
        export_path = await storage.save(docx_bytes, filename, folder="exports")
        
        logger.info(f"Saved to {export_path}, updating memo record...")
        
        # Update memo with export path
        memo.export_path = export_path
        await db.commit()
        
        logger.info(f"Export complete for memo {memo.id}")
        
        return ExportResponse(
            success=True,
            export_id=memo.id,
            download_url=f"/api/v1/exports/{memo.id}",
            filename=filename,
        )
    
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Log and wrap unexpected errors
        logger.error(f"Export failed for initiative {initiative_id}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Export failed: {str(e)}",
        )


@router.get("/exports/{memo_id}")
async def download_export(
    memo_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Download an exported DOCX file"""
    # Get memo and verify access
    memo_result = await db.execute(
        select(MemoVersion).where(MemoVersion.id == memo_id)
    )
    memo = memo_result.scalar_one_or_none()
    
    if not memo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Export not found",
        )
    
    initiative = await require_viewer(db, memo.initiative_id, user)
    
    if not memo.export_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Export file not found. Generate export first.",
        )
    
    # Get file from storage
    storage = get_storage()
    file_bytes = await storage.load(memo.export_path)
    
    filename = f"memo_{initiative.title or 'untitled'}.docx".replace(" ", "_")
    
    # Return file
    return Response(
        content=file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )


@router.post("/initiatives/{initiative_id}/export-checklist")
async def export_checklist(
    initiative_id: UUID,
    data: ChecklistExportRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Export checklist to Excel"""
    initiative = await require_viewer(db, initiative_id, user)
    
    # Generate Excel
    exporter = ExcelExporterService()
    filepath = await exporter.export_checklist(data.content)
    
    # Read the file
    with open(filepath, 'rb') as f:
        file_bytes = f.read()
    
    filename = f"due_diligence_checklist_{initiative.title or 'untitled'}.xlsx".replace(" ", "_")
    
    return Response(
        content=file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )


@router.get("/initiatives/{initiative_id}/deliverables/{tool_id}/export")
async def export_deliverable(
    initiative_id: UUID,
    tool_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Export any generated deliverable to its native file format (DOCX or XLSX).

    Reads content directly from the DB so the frontend never needs to send
    input data back — avoids round-trip serialisation bugs.
    """
    initiative = await require_viewer(db, initiative_id, user)

    deliverables: dict[str, Any] = initiative.deliverables or {}
    data = deliverables.get(tool_id)

    # Fallback: tool_id might be a MemoVersion UUID (legacy path)
    if data is None:
        try:
            memo_uuid = UUID(tool_id)
            memo_res = await db.execute(
                select(MemoVersion).where(
                    MemoVersion.id == memo_uuid,
                    MemoVersion.initiative_id == initiative_id,
                )
            )
            memo = memo_res.scalar_one_or_none()
            if not memo:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deliverable not found")
            data = {
                "output_type": "memo",
                "title": (memo.content or {}).get("title", "Investment Memo"),
                "content": memo.content or {},
            }
        except ValueError:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deliverable not found")

    output_type: str = data.get("output_type", "document")
    content: dict = data.get("content") or {}
    title: str = data.get("title", tool_id.replace("_", " ").title())
    safe_title = re.sub(r"[^\w\s\-.]", "_", title).replace(" ", "_")[:60]

    # ── Memo → DOCX ──────────────────────────────────────────────────────────
    if output_type == "memo":
        memo_res = await db.execute(
            select(MemoVersion)
            .where(MemoVersion.initiative_id == initiative_id)
            .order_by(MemoVersion.created_at.desc())
            .limit(1)
        )
        memo = memo_res.scalar_one_or_none()
        if not memo:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No memo found")

        storage = get_storage()
        if memo.export_path:
            file_bytes = await storage.load(memo.export_path)
        else:
            exporter = DocxExporterService()
            if "sections" in (memo.content or {}):
                file_bytes = exporter.generate_from_sections(
                    memo_content=memo.content,
                    initiative_title=initiative.title or "Untitled",
                )
            else:
                memo_content_obj = MemoContent(**memo.content)
                file_bytes = exporter.generate(
                    memo_content=memo_content_obj,
                    initiative_title=initiative.title or "Untitled",
                )
            export_path = await storage.save(file_bytes, f"{safe_title}_{memo.id}.docx", folder="exports")
            memo.export_path = export_path
            await db.commit()

        return Response(
            content=file_bytes,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{safe_title}.docx"'},
        )

    # ── Checklist → XLSX ─────────────────────────────────────────────────────
    if output_type == "checklist":
        exporter = ExcelExporterService()
        filepath = await exporter.export_checklist(content)
        with open(filepath, "rb") as f:
            file_bytes = f.read()
        return Response(
            content=file_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{safe_title}.xlsx"'},
        )

    # ── LCOE → XLSX ──────────────────────────────────────────────────────────
    if output_type == "lcoe":
        from app.api.lcoe import export_lcoe_excel, RecalculateRequest as LCOEReq
        inputs: dict[str, Any] = content.get("inputs") or {}
        if not inputs:
            inputs = await _recover_model_inputs(db, initiative_id, ("lcoe_output", "lcoe_inputs"))
        if not inputs:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LCOE model inputs are not available for export. "
                       "Open the model in the chat and recalculate to refresh the data.",
            )
        return await export_lcoe_excel(data=LCOEReq(inputs=inputs), user=user)

    # ── Carbon → XLSX ────────────────────────────────────────────────────────
    if output_type == "carbon":
        from app.api.carbon import export_carbon_excel, RecalculateRequest as CarbonReq
        inputs = content.get("inputs") or {}
        if not inputs:
            inputs = await _recover_model_inputs(db, initiative_id, ("carbon_output", "carbon_inputs"))
        if not inputs:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Carbon model inputs are not available for export. "
                       "Open the model in the chat and recalculate to refresh the data.",
            )
        return await export_carbon_excel(data=CarbonReq(inputs=inputs), user=user)

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Export not supported for output type: {output_type}",
    )


async def _recover_model_inputs(
    db: AsyncSession,
    initiative_id: UUID,
    widget_types: tuple[str, ...],
) -> dict[str, Any]:
    """Scan chat messages to find the most recent computable model inputs.

    Used as a fallback when the deliverable's stored inputs are stale or empty.
    """
    from sqlalchemy import and_
    result = await db.execute(
        select(ChatMessage)
        .where(
            and_(
                ChatMessage.initiative_id == initiative_id,
                ChatMessage.widget_type.in_(widget_types),
            )
        )
        .order_by(ChatMessage.created_at.desc())
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
