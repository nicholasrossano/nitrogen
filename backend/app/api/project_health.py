"""Project-level health table endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser, get_current_user
from app.core.database import get_db
from app.core.permissions import require_editor, require_viewer
from app.domain.registry import get_project_health_definition
from app.schemas.project_health import (
    ProjectHealthDimensionResponse,
    ProjectHealthOverrideEntry,
    ProjectHealthOverrideRequest,
    ProjectHealthRefreshRequest,
    ProjectHealthResponse,
)
from app.services.project_health import apply_project_health_override, list_project_health, refresh_project_health

router = APIRouter()


def _module_display_names(row, supporting_signals: dict) -> list[str]:
    structured = supporting_signals.get("structured_state") if isinstance(supporting_signals, dict) else {}
    assessment_state = structured.get("assessment") if isinstance(structured, dict) else {}
    completed_outputs = assessment_state.get("completed_output_excerpts") if isinstance(assessment_state, dict) else []
    title_by_id: dict[str, str] = {}
    if isinstance(completed_outputs, list):
        for item in completed_outputs:
            if not isinstance(item, dict):
                continue
            assessment_id = str(item.get("assessment_id") or "").strip()
            title = str(item.get("title") or "").strip()
            if assessment_id and title and assessment_id not in title_by_id:
                title_by_id[assessment_id] = title
    names: list[str] = []
    for module_id in (row.relevant_modules or []):
        module_key = str(module_id).strip()
        if not module_key:
            continue
        names.append(title_by_id.get(module_key) or module_key)
    return names


def _module_reference_entries(row, supporting_signals: dict) -> list[dict]:
    structured = supporting_signals.get("structured_state") if isinstance(supporting_signals, dict) else {}
    assessment_state = structured.get("assessment") if isinstance(structured, dict) else {}
    completed_outputs = assessment_state.get("completed_output_excerpts") if isinstance(assessment_state, dict) else []
    refs_by_assessment: dict[str, dict] = {}
    if isinstance(completed_outputs, list):
        for item in completed_outputs:
            if not isinstance(item, dict):
                continue
            assessment_id = str(item.get("assessment_id") or "").strip()
            instance_id = str(item.get("instance_id") or "").strip()
            display_name = str(item.get("display_name") or item.get("title") or "").strip()
            if not assessment_id or not instance_id or not display_name:
                continue
            if assessment_id not in refs_by_assessment:
                refs_by_assessment[assessment_id] = {
                    "instance_id": instance_id,
                    "assessment_id": assessment_id,
                    "display_name": display_name,
                }
    refs: list[dict] = []
    for module_id in (row.relevant_modules or []):
        key = str(module_id).strip()
        if not key:
            continue
        ref = refs_by_assessment.get(key)
        if ref:
            refs.append(ref)
        else:
            refs.append(
                {
                    "instance_id": None,
                    "assessment_id": key,
                    "display_name": key.replace("_", " ").title(),
                }
            )
    return refs


def _serialize_dimension(
    *,
    row,
    dimension: dict,
    overrides: list,
) -> ProjectHealthDimensionResponse:
    latest_override = overrides[0] if overrides else None
    effective_status = latest_override.override_status if latest_override else row.status
    supporting_signals = row.supporting_signals or {}
    critical_assessment = supporting_signals.get("critical_assessment") or {}
    retrieved_context = supporting_signals.get("retrieved_context") or {}
    module_names = _module_display_names(row, supporting_signals)
    module_refs = _module_reference_entries(row, supporting_signals)
    override_entries = [
        ProjectHealthOverrideEntry(
            id=str(item.id),
            dimension_id=item.dimension_id,
            prior_system_status=item.prior_system_status,
            override_status=item.override_status,
            explanation=item.explanation,
            overridden_by_email=item.overridden_by_email,
            created_at=item.created_at,
        )
        for item in overrides
    ]
    return ProjectHealthDimensionResponse(
        dimension_id=row.dimension_id,
        label=row.dimension_label or dimension["label"],
        description=dimension["description"],
        status=row.status,
        effective_status=effective_status,
        confidence=row.confidence,
        rationale=row.rationale,
        critical_insight=critical_assessment.get("critical_insight") or row.rationale,
        supporting_evidence=critical_assessment.get("supporting_evidence") or row.positive_drivers or [],
        suggested_improvement=critical_assessment.get("suggested_improvement") or (row.improvement_actions or [None])[0],
        retrieved_sources=retrieved_context.get("facts") or [],
        positive_drivers=row.positive_drivers or [],
        negative_drivers=row.negative_drivers or [],
        blockers=row.blockers or [],
        missing_items=row.missing_items or [],
        relevant_modules=row.relevant_modules or [],
        relevant_module_names=module_names,
        relevant_assessments=module_refs,
        improvement_actions=row.improvement_actions or [],
        uncertainties=row.uncertainties or [],
        update_source=row.update_source,
        last_updated_at=row.last_updated_at,
        is_stale=row.is_stale,
        has_override=latest_override is not None,
        overrides=override_entries,
    )


@router.get(
    "/initiatives/{initiative_id}/project-health",
    response_model=ProjectHealthResponse,
)
async def get_project_health(
    initiative_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Return persisted project health rows and override history for one initiative."""
    initiative = await require_viewer(db, initiative_id, user)
    definition = get_project_health_definition()
    dims_by_id = {d.id: {"label": d.label, "description": d.description} for d in definition.dimensions}
    rows, overrides_by_dimension, domain = await list_project_health(db, initiative)

    if not rows:
        placeholder_rows = [
            ProjectHealthDimensionResponse(
                dimension_id=d.id,
                label=d.label,
                description=d.description,
                status="unknown",
                effective_status="unknown",
                confidence="unknown",
                rationale="Not enough information has been synthesized yet. Run refresh to compute the health overview.",
                critical_insight="Not enough project context has been retrieved yet to assess this dimension.",
                supporting_evidence=[],
                suggested_improvement="Run Refresh after adding or updating project materials.",
                retrieved_sources=[],
                positive_drivers=[],
                negative_drivers=[],
                blockers=[],
                missing_items=[],
                relevant_modules=list(d.relevant_assessment_ids),
                relevant_module_names=list(d.relevant_assessment_ids),
                relevant_assessments=[],
                improvement_actions=[],
                uncertainties=[],
                update_source="not_generated",
                last_updated_at=initiative.updated_at,
                is_stale=True,
                has_override=False,
                overrides=[],
            )
            for d in definition.dimensions
        ]
        return ProjectHealthResponse(
            domain=domain,
            initiative_id=str(initiative.id),
            stale=True,
            dimensions=placeholder_rows,
        )

    response_rows = [
        _serialize_dimension(
            row=row,
            dimension=dims_by_id.get(row.dimension_id, {"label": row.dimension_label, "description": ""}),
            overrides=overrides_by_dimension.get(row.dimension_id, []),
        )
        for row in rows
    ]
    response_rows.sort(key=lambda item: item.label.lower())
    return ProjectHealthResponse(
        domain=domain,
        initiative_id=str(initiative.id),
        stale=any(item.is_stale for item in response_rows),
        dimensions=response_rows,
    )


@router.post(
    "/initiatives/{initiative_id}/project-health/refresh",
    response_model=ProjectHealthResponse,
)
async def refresh_project_health_rows(
    initiative_id: str,
    body: ProjectHealthRefreshRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Recompute and persist all project-health dimensions for one initiative."""
    initiative = await require_editor(db, initiative_id, user)
    await refresh_project_health(db, initiative, source=body.source, user_id=user.uid)
    initiative.touch()
    await db.commit()
    return await get_project_health(initiative_id=initiative_id, db=db, user=user)


@router.post(
    "/initiatives/{initiative_id}/project-health/{dimension_id}/override",
    response_model=ProjectHealthResponse,
)
async def override_project_health_dimension(
    initiative_id: str,
    dimension_id: str,
    body: ProjectHealthOverrideRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Record a human override for a single project-health dimension."""
    initiative = await require_editor(db, initiative_id, user)
    definition = get_project_health_definition()
    known_ids = {d.id for d in definition.dimensions}
    if dimension_id not in known_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown project health dimension")
    await apply_project_health_override(
        db=db,
        initiative=initiative,
        dimension_id=dimension_id,
        override_status=body.status,
        explanation=body.explanation,
        user_id=user.uid,
        user_email=user.email,
    )
    initiative.touch()
    await db.commit()
    return await get_project_health(initiative_id=initiative_id, db=db, user=user)
