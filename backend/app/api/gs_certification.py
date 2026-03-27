"""
Gold Standard Certification API

Endpoints for template management, workspace CRUD, field editing,
checklist state, and DOCX export.
"""

import logging
import os
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, MockUser, AuthUser
from app.core.database import get_db
from app.core.permissions import require_viewer, require_editor
from app.models.chat import CoreChatSession
from app.models.gs_template import GSTemplateVersion
from app.models.gs_workspace import GSCertificationWorkspace
from app.services.gs_template_service import (
    GSTemplateService,
    TEMPLATE_TYPE_COVER_LETTER,
    TEMPLATE_TYPE_PRELIMINARY_REVIEW,
)
from app.services.gs_cover_letter import CoverLetterService, GS_CHECKLIST_ITEMS

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class CreateWorkspaceRequest(BaseModel):
    initiative_id: Optional[str] = None
    session_id: Optional[str] = None
    template_type: str = "cover_letter"  # cover_letter | preliminary_review


class UpdateFieldsRequest(BaseModel):
    fields: dict[str, str]  # {field_id: value}


class UpdateChecklistRequest(BaseModel):
    item_id: str
    status: str  # not_started, in_progress, complete


class ApproveTemplateRequest(BaseModel):
    approved_by: str


# ---------------------------------------------------------------------------
# Template endpoints
# ---------------------------------------------------------------------------

@router.get("/gs/template/active/{template_type}")
async def get_active_template_schema(
    template_type: str,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Return field schema and section context for the active template of this type."""
    if template_type not in (TEMPLATE_TYPE_COVER_LETTER, TEMPLATE_TYPE_PRELIMINARY_REVIEW):
        raise HTTPException(status_code=400, detail=f"Unknown template type: {template_type}")
    template_svc = GSTemplateService(db)
    template = await template_svc.get_or_fetch_active_template(template_type)
    section_contexts = template_svc.get_section_contexts(template_type)
    return {
        "template_type": template_type,
        "template_version_id": str(template.id),
        "template_version_label": template.version_label,
        "template_status": template.status,
        "field_schema": template.field_schema or [],
        "section_context": section_contexts,
    }


@router.get("/gs/template/status")
async def get_template_status(
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Check if the GS Cover Letter template is up to date."""
    svc = GSTemplateService(db)
    status_info = await svc.check_for_updates(TEMPLATE_TYPE_COVER_LETTER)
    return {
        "up_to_date": status_info.up_to_date,
        "latest_approved_version_id": status_info.latest_approved_version_id,
        "latest_approved_label": status_info.latest_approved_label,
        "draft_available": status_info.draft_available,
        "draft_version_id": status_info.draft_version_id,
    }


@router.get("/gs/template/{version_id}/preview")
async def get_template_preview(
    version_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Return the annotated HTML preview for a template version."""
    svc = GSTemplateService(db)
    version = await svc.get_version(version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Template version not found")
    return {
        "version_id": str(version.id),
        "version_label": version.version_label,
        "status": version.status,
        "html_preview": version.html_preview,
    }


@router.get("/gs/template/{version_id}/fields")
async def get_template_fields(
    version_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Return the field schema for a template version."""
    svc = GSTemplateService(db)
    version = await svc.get_version(version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Template version not found")
    return {
        "version_id": str(version.id),
        "field_schema": version.field_schema or [],
    }


@router.post("/gs/admin/template/{version_id}/approve")
async def approve_template(
    version_id: UUID,
    data: ApproveTemplateRequest,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Admin: approve a draft template version."""
    admin_uids = os.environ.get("ADMIN_UIDS", "").split(",")
    admin_uids = [uid.strip() for uid in admin_uids if uid.strip()]
    if not admin_uids or user.uid not in admin_uids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    svc = GSTemplateService(db)
    try:
        version = await svc.approve_template(version_id, data.approved_by)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid template version or state")
    return {
        "version_id": str(version.id),
        "status": version.status,
        "approved_by": version.approved_by,
        "approved_at": version.approved_at.isoformat() if version.approved_at else None,
    }


# ---------------------------------------------------------------------------
# Workspace endpoints
# ---------------------------------------------------------------------------

@router.post("/gs/workspace")
async def create_workspace(
    data: CreateWorkspaceRequest,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Create a GS certification workspace, pinning the active template version."""
    initiative_id = UUID(data.initiative_id) if data.initiative_id else None
    session_id = UUID(data.session_id) if data.session_id else None
    template_type = data.template_type or "cover_letter"
    if template_type not in (TEMPLATE_TYPE_COVER_LETTER, TEMPLATE_TYPE_PRELIMINARY_REVIEW):
        template_type = TEMPLATE_TYPE_COVER_LETTER

    # Validate the user has access to the linked initiative or session
    if initiative_id:
        await require_editor(db, initiative_id, user)
    elif session_id:
        sess_result = await db.execute(
            select(CoreChatSession).where(
                CoreChatSession.id == session_id,
                CoreChatSession.user_id == user.uid,
            )
        )
        if not sess_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    # Check for existing workspace for this document type
    query = select(GSCertificationWorkspace).where(
        GSCertificationWorkspace.template_type == template_type,
    )
    if initiative_id:
        query = query.where(GSCertificationWorkspace.initiative_id == initiative_id)
    elif session_id:
        query = query.where(GSCertificationWorkspace.session_id == session_id)
    result = await db.execute(query.limit(1))
    existing = result.scalar_one_or_none()
    if existing:
        return _workspace_response(existing)

    # Get or fetch the active template for this document type
    template_svc = GSTemplateService(db)
    template = await template_svc.get_or_fetch_active_template(template_type)

    workspace = GSCertificationWorkspace(
        initiative_id=initiative_id,
        session_id=session_id,
        template_version_id=template.id,
        template_type=template_type,
        field_values={},
        checklist_state={item["id"]: {"status": "not_started"} for item in GS_CHECKLIST_ITEMS},
        export_history=[],
    )
    db.add(workspace)
    await db.flush()
    await db.commit()
    await db.refresh(workspace)
    return _workspace_response(workspace)


@router.get("/gs/workspace/{workspace_id}")
async def get_workspace(
    workspace_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Get workspace state including field values and checklist."""
    workspace = await _load_workspace(db, workspace_id)
    await _authorize_workspace(db, workspace, user)
    return _workspace_response(workspace)


@router.get("/gs/workspace/by-initiative/{initiative_id}")
async def get_workspace_by_initiative(
    initiative_id: UUID,
    template_type: str = "cover_letter",
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Look up workspace by initiative ID and document type."""
    await require_viewer(db, initiative_id, user)
    result = await db.execute(
        select(GSCertificationWorkspace).where(
            GSCertificationWorkspace.initiative_id == initiative_id,
            GSCertificationWorkspace.template_type == template_type,
        ).limit(1)
    )
    workspace = result.scalar_one_or_none()
    if not workspace:
        raise HTTPException(status_code=404, detail="No GS workspace for this initiative")
    return _workspace_response(workspace)


@router.get("/gs/workspace/by-session/{session_id}")
async def get_workspace_by_session(
    session_id: UUID,
    template_type: str = "cover_letter",
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Look up workspace by chat session ID and document type."""
    sess_result = await db.execute(
        select(CoreChatSession).where(
            CoreChatSession.id == session_id,
            CoreChatSession.user_id == user.uid,
        )
    )
    if not sess_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    result = await db.execute(
        select(GSCertificationWorkspace).where(
            GSCertificationWorkspace.session_id == session_id,
            GSCertificationWorkspace.template_type == template_type,
        ).limit(1)
    )
    workspace = result.scalar_one_or_none()
    if not workspace:
        raise HTTPException(status_code=404, detail="No GS workspace for this session")
    return _workspace_response(workspace)


# ---------------------------------------------------------------------------
# Field value endpoints
# ---------------------------------------------------------------------------

@router.get("/gs/workspace/{workspace_id}/fields")
async def get_fields(
    workspace_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Get current field values with completion status."""
    workspace = await _load_workspace(db, workspace_id)
    await _authorize_workspace(db, workspace, user)
    template = await _load_template(db, workspace.template_version_id)

    svc = CoverLetterService()
    completion = svc.get_completion_status(template.field_schema or [], workspace.field_values or {})
    return {
        "workspace_id": str(workspace.id),
        "field_values": workspace.field_values or {},
        "completion": asdict(completion),
    }


@router.post("/gs/workspace/{workspace_id}/fields")
async def update_fields(
    workspace_id: UUID,
    data: UpdateFieldsRequest,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Update one or more field values."""
    workspace = await _load_workspace(db, workspace_id)
    await _authorize_workspace(db, workspace, user, write=True)

    current = dict(workspace.field_values or {})
    now = datetime.now(timezone.utc).isoformat()
    for field_id, value in data.fields.items():
        current[field_id] = {
            "value": value,
            "source": "manual",
            "updated_at": now,
        }
    workspace.field_values = current
    workspace.updated_at = datetime.now(timezone.utc)

    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(workspace, "field_values")
    await db.commit()
    await db.refresh(workspace)

    # Also update checklist state for cover_letter
    template = await _load_template(db, workspace.template_version_id)
    svc = CoverLetterService()
    completion = svc.get_completion_status(template.field_schema or [], workspace.field_values or {})

    cl_state = dict(workspace.checklist_state or {})
    if completion.status == "not_started":
        cl_state["cover_letter"] = {"status": "not_started"}
    elif completion.status in ("complete", "ready_for_signature"):
        cl_state["cover_letter"] = {"status": "complete"}
    else:
        cl_state["cover_letter"] = {"status": "in_progress"}
    workspace.checklist_state = cl_state
    flag_modified(workspace, "checklist_state")
    await db.commit()

    return {
        "workspace_id": str(workspace.id),
        "field_values": workspace.field_values,
        "completion": asdict(completion),
    }


# ---------------------------------------------------------------------------
# Checklist endpoints
# ---------------------------------------------------------------------------

@router.get("/gs/checklist")
async def get_checklist(
    user: MockUser = Depends(get_current_user),
):
    """Return the static GS4GG checklist items."""
    return {"items": GS_CHECKLIST_ITEMS}


@router.post("/gs/workspace/{workspace_id}/checklist")
async def update_checklist(
    workspace_id: UUID,
    data: UpdateChecklistRequest,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Update a checklist item status."""
    workspace = await _load_workspace(db, workspace_id)
    await _authorize_workspace(db, workspace, user, write=True)
    cl_state = dict(workspace.checklist_state or {})
    cl_state[data.item_id] = {"status": data.status}
    workspace.checklist_state = cl_state
    workspace.updated_at = datetime.now(timezone.utc)

    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(workspace, "checklist_state")
    await db.commit()

    return {"workspace_id": str(workspace.id), "checklist_state": workspace.checklist_state}


# ---------------------------------------------------------------------------
# Export endpoint
# ---------------------------------------------------------------------------

@router.post("/gs/workspace/{workspace_id}/export")
async def export_cover_letter(
    workspace_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: MockUser = Depends(get_current_user),
):
    """Generate and return a filled DOCX from the workspace field values."""
    workspace = await _load_workspace(db, workspace_id)
    await _authorize_workspace(db, workspace, user)
    template = await _load_template(db, workspace.template_version_id)

    svc = CoverLetterService()
    filled_bytes = svc.fill_template(
        template.file_bytes,
        template.field_schema or [],
        workspace.field_values or {},
    )

    now = datetime.now(timezone.utc)
    history = list(workspace.export_history or [])
    history.append({
        "exported_at": now.isoformat(),
        "template_version": template.version_label,
        "format": "docx",
    })
    workspace.export_history = history
    workspace.updated_at = now

    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(workspace, "export_history")
    await db.commit()

    doc_name = "Preliminary_Review" if template.template_type == TEMPLATE_TYPE_PRELIMINARY_REVIEW else "Cover_Letter"
    filename = f"GS_{doc_name}_{now.strftime('%Y%m%d')}.docx"
    return Response(
        content=filled_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _load_workspace(db: AsyncSession, workspace_id: UUID) -> GSCertificationWorkspace:
    result = await db.execute(
        select(GSCertificationWorkspace).where(GSCertificationWorkspace.id == workspace_id)
    )
    ws = result.scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return ws


async def _authorize_workspace(
    db: AsyncSession, workspace: GSCertificationWorkspace, user: AuthUser, *, write: bool = False,
) -> None:
    """Verify the authenticated user has access to this workspace's project or session."""
    if workspace.initiative_id:
        if write:
            await require_editor(db, workspace.initiative_id, user)
        else:
            await require_viewer(db, workspace.initiative_id, user)
    elif workspace.session_id:
        result = await db.execute(
            select(CoreChatSession).where(
                CoreChatSession.id == workspace.session_id,
                CoreChatSession.user_id == user.uid,
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    else:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")


async def _load_template(db: AsyncSession, version_id: UUID) -> GSTemplateVersion:
    result = await db.execute(
        select(GSTemplateVersion).where(GSTemplateVersion.id == version_id)
    )
    tv = result.scalar_one_or_none()
    if not tv:
        raise HTTPException(status_code=404, detail="Template version not found")
    return tv


def _workspace_response(workspace: GSCertificationWorkspace) -> dict:
    return {
        "id": str(workspace.id),
        "initiative_id": str(workspace.initiative_id) if workspace.initiative_id else None,
        "session_id": str(workspace.session_id) if workspace.session_id else None,
        "template_version_id": str(workspace.template_version_id),
        "field_values": workspace.field_values or {},
        "checklist_state": workspace.checklist_state or {},
        "export_history": workspace.export_history or [],
        "created_at": workspace.created_at.isoformat() if workspace.created_at else None,
        "updated_at": workspace.updated_at.isoformat() if workspace.updated_at else None,
    }
