"""Initiative-level decision log APIs."""

from __future__ import annotations

import re
import uuid as _uuid

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser, get_current_user
from app.core.database import get_db
from app.core.filename_utils import safe_content_disposition
from app.core.permissions import require_viewer
from app.models.assessment_instance import AssessmentInstance
from app.services.decision_event_service import append_decision_event
from app.services.decision_log_service import (
    build_decision_log_xlsx,
    build_initiative_decision_log,
)

router = APIRouter()


@router.get("/initiatives/{initiative_id}/decision-log")
async def get_initiative_decision_log(
    initiative_id: _uuid.UUID,
    assessment_instance_id: _uuid.UUID | None = None,
    assessment_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Return current-state and history rows for an initiative decision log."""
    await require_viewer(db, initiative_id, user)
    return await build_initiative_decision_log(
        db,
        initiative_id=initiative_id,
        assessment_instance_id=assessment_instance_id,
        assessment_id=assessment_id,
    )


@router.get("/initiatives/{initiative_id}/decision-log/export.xlsx")
async def export_initiative_decision_log(
    initiative_id: _uuid.UUID,
    assessment_instance_id: _uuid.UUID | None = None,
    assessment_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Export an initiative decision log workbook with Current State and History sheets."""
    initiative = await require_viewer(db, initiative_id, user)
    report = await build_initiative_decision_log(
        db,
        initiative_id=initiative_id,
        assessment_instance_id=assessment_instance_id,
        assessment_id=assessment_id,
    )
    xlsx_bytes = build_decision_log_xlsx(report)

    if assessment_instance_id is not None:
        inst = await db.get(AssessmentInstance, assessment_instance_id)
        if inst is not None:
            await append_decision_event(
                db,
                inst=inst,
                event_type="decision_log_exported",
                entity_type="export",
                entity_id="xlsx",
                actor_user_id=user.uid,
                actor_email=user.email,
                payload={"format": "xlsx", "scope": "filtered_assessment"},
            )
            await db.commit()

    filename_base = re.sub(
        r"[^\w\s\-.]",
        "_",
        f"Decision_Log_{initiative.title or 'Project'}",
    ).replace(" ", "_")[:80]
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": safe_content_disposition(f"{filename_base}.xlsx")},
    )
