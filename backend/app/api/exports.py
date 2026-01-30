from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from pathlib import Path
from pydantic import BaseModel
from typing import Optional

from app.core.database import get_db
from app.core.auth import get_current_user, MockUser
from app.core.storage import get_storage
from app.models.initiative import Initiative
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
    user: MockUser = Depends(get_current_user),
):
    """Export memo to DOCX"""
    # Verify access
    result = await db.execute(
        select(Initiative).where(
            Initiative.id == initiative_id,
            Initiative.user_id == user.uid,
        )
    )
    initiative = result.scalar_one_or_none()
    
    if not initiative:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Initiative not found",
        )
    
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No memo found to export",
        )
    
    # Generate DOCX
    exporter = DocxExporterService()
    memo_content = MemoContent(**memo.content)
    
    docx_bytes = exporter.generate(
        memo_content=memo_content,
        initiative_title=initiative.title or "Untitled Initiative",
    )
    
    # Save to storage
    storage = get_storage()
    filename = f"memo_{initiative.title or 'untitled'}_{memo.id}.docx".replace(" ", "_")
    export_path = await storage.save(docx_bytes, filename, folder="exports")
    
    # Update memo with export path
    memo.export_path = export_path
    await db.commit()
    
    return ExportResponse(
        success=True,
        export_id=memo.id,
        download_url=f"/api/v1/exports/{memo.id}",
        filename=filename,
    )


@router.get("/exports/{memo_id}")
async def download_export(
    memo_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
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
    
    # Verify user owns the initiative
    initiative_result = await db.execute(
        select(Initiative).where(
            Initiative.id == memo.initiative_id,
            Initiative.user_id == user.uid,
        )
    )
    initiative = initiative_result.scalar_one_or_none()
    
    if not initiative:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    
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
    user: MockUser = Depends(get_current_user),
):
    """Export checklist to Excel"""
    # Verify access
    result = await db.execute(
        select(Initiative).where(
            Initiative.id == initiative_id,
            Initiative.user_id == user.uid,
        )
    )
    initiative = result.scalar_one_or_none()
    
    if not initiative:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Initiative not found",
        )
    
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
