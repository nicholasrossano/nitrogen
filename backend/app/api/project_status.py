"""Project status overview endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthUser, get_current_user
from app.core.database import get_db
from app.core.permissions import require_project_editor as require_editor, require_project_viewer as require_viewer
from app.schemas.project_status import (
    ProjectStatusCategoryConfig,
    ProjectStatusCategoryCreateRequest,
    ProjectStatusCategoryRow,
    ProjectStatusCategoryUpdateRequest,
    ProjectStatusCriteria,
    ProjectStatusCriteriaGenerateRequest,
    ProjectStatusOverrideEntry,
    ProjectStatusOverrideRequest,
    ProjectStatusRefreshRequest,
    ProjectStatusResponse,
)
from app.services.project_status import (
    apply_project_status_override,
    create_status_category,
    delete_status_category,
    generate_category_criteria_for_row,
    list_project_status,
    list_status_category_configs,
    refresh_project_status,
    update_status_category,
)

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


def _criteria_summary(category) -> str | None:
    if not isinstance(category.criteria, dict):
        return None
    summary = str(category.criteria.get("summary") or "").strip()
    return summary or None


def _serialize_category_config(row) -> ProjectStatusCategoryConfig:
    criteria = None
    if isinstance(row.criteria, dict):
        criteria = ProjectStatusCriteria.model_validate(row.criteria)
    return ProjectStatusCategoryConfig(
        id=str(row.id),
        category_key=row.category_key,
        label=row.label,
        definition_text=row.definition_text,
        criteria=criteria,
        is_active=row.is_active,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _serialize_category_row(
    *,
    category,
    result_row,
    overrides: list,
) -> ProjectStatusCategoryRow:
    latest_override = overrides[0] if overrides else None
    if result_row is None:
        return ProjectStatusCategoryRow(
            category_key=category.category_key,
            label=category.label,
            definition_text=category.definition_text,
            criteria_summary=_criteria_summary(category),
            status="unknown",
            effective_status="unknown",
            confidence="unknown",
            rationale=(
                "Generate criteria from your definition, then refresh to assess against project materials."
            ),
            critical_insight=(
                "No assessment yet. Generate criteria from your definition, then refresh to assess."
            ),
            supporting_evidence=[],
            suggested_improvement="Generate criteria, then refresh the status overview.",
            retrieved_sources=[],
            positive_drivers=[],
            negative_drivers=[],
            blockers=[],
            missing_items=[],
            relevant_modules=[],
            relevant_module_names=[],
            relevant_assessments=[],
            improvement_actions=[],
            uncertainties=[],
            update_source="not_generated",
            last_updated_at=category.updated_at,
            is_stale=True,
            has_override=False,
            overrides=[],
        )

    effective_status = latest_override.override_status if latest_override else result_row.status
    supporting_signals = result_row.supporting_signals or {}
    critical_assessment = supporting_signals.get("critical_assessment") or {}
    retrieved_context = supporting_signals.get("retrieved_context") or {}
    module_names = _module_display_names(result_row, supporting_signals)
    module_refs = _module_reference_entries(result_row, supporting_signals)
    override_entries = [
        ProjectStatusOverrideEntry(
            id=str(item.id),
            category_key=item.category_key,
            prior_system_status=item.prior_system_status,
            override_status=item.override_status,
            explanation=item.explanation,
            overridden_by_email=item.overridden_by_email,
            created_at=item.created_at,
        )
        for item in overrides
    ]
    return ProjectStatusCategoryRow(
        category_key=result_row.category_key,
        label=category.label,
        definition_text=category.definition_text,
        criteria_summary=_criteria_summary(category),
        status=result_row.status,
        effective_status=effective_status,
        confidence=result_row.confidence,
        rationale=result_row.rationale,
        critical_insight=critical_assessment.get("critical_insight") or result_row.rationale,
        supporting_evidence=critical_assessment.get("supporting_evidence") or result_row.positive_drivers or [],
        suggested_improvement=critical_assessment.get("suggested_improvement")
        or (result_row.improvement_actions or [None])[0],
        retrieved_sources=retrieved_context.get("facts") or [],
        positive_drivers=result_row.positive_drivers or [],
        negative_drivers=result_row.negative_drivers or [],
        blockers=result_row.blockers or [],
        missing_items=result_row.missing_items or [],
        relevant_modules=result_row.relevant_modules or [],
        relevant_module_names=module_names,
        relevant_assessments=module_refs,
        improvement_actions=result_row.improvement_actions or [],
        uncertainties=result_row.uncertainties or [],
        update_source=result_row.update_source,
        last_updated_at=result_row.last_updated_at,
        is_stale=result_row.is_stale,
        has_override=latest_override is not None,
        overrides=override_entries,
    )


def _build_status_response(
    *,
    project,
    categories,
    result_rows,
    overrides_by_category,
    domain: str,
) -> ProjectStatusResponse:
    results_by_key = {row.category_key: row for row in result_rows}
    response_rows = [
        _serialize_category_row(
            category=category,
            result_row=results_by_key.get(category.category_key),
            overrides=overrides_by_category.get(category.category_key, []),
        )
        for category in categories
    ]
    response_rows.sort(key=lambda item: item.label.lower())
    return ProjectStatusResponse(
        domain=domain,
        project_id=str(project.id),
        stale=any(item.is_stale for item in response_rows),
        categories=response_rows,
    )


@router.get("/projects/{project_id}/project-status", response_model=ProjectStatusResponse)
async def get_project_status(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    project = await require_viewer(db, project_id, user)
    categories, result_rows, overrides_by_category, domain = await list_project_status(db, project)
    return _build_status_response(
        project=project,
        categories=categories,
        result_rows=result_rows,
        overrides_by_category=overrides_by_category,
        domain=domain,
    )


@router.post("/projects/{project_id}/project-status/refresh", response_model=ProjectStatusResponse)
async def refresh_project_status_rows(
    project_id: str,
    body: ProjectStatusRefreshRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    project = await require_editor(db, project_id, user)
    await refresh_project_status(db, project, source=body.source, user_id=user.uid)
    project.touch()
    await db.commit()
    return await get_project_status(project_id=project_id, db=db, user=user)


@router.post(
    "/projects/{project_id}/project-status/{category_key}/override",
    response_model=ProjectStatusResponse,
)
async def override_project_status_category(
    project_id: str,
    category_key: str,
    body: ProjectStatusOverrideRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    project = await require_editor(db, project_id, user)
    try:
        await apply_project_status_override(
            db=db,
            project=project,
            category_key=category_key,
            override_status=body.status,
            explanation=body.explanation,
            user_id=user.uid,
            user_email=user.email,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    project.touch()
    await db.commit()
    return await get_project_status(project_id=project_id, db=db, user=user)


@router.get(
    "/projects/{project_id}/project-status/categories",
    response_model=list[ProjectStatusCategoryConfig],
)
async def list_status_categories(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    project = await require_viewer(db, project_id, user)
    rows = await list_status_category_configs(db, project)
    return [_serialize_category_config(row) for row in rows]


@router.post(
    "/projects/{project_id}/project-status/categories",
    response_model=ProjectStatusCategoryConfig,
    status_code=status.HTTP_201_CREATED,
)
async def create_status_category_row(
    project_id: str,
    body: ProjectStatusCategoryCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    project = await require_editor(db, project_id, user)
    try:
        row = await create_status_category(
            db,
            project,
            label=body.label,
            definition_text=body.definition_text,
            category_key=body.category_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    project.touch()
    await db.commit()
    await db.refresh(row)
    return _serialize_category_config(row)


@router.patch(
    "/projects/{project_id}/project-status/categories/{category_key}",
    response_model=ProjectStatusCategoryConfig,
)
async def update_status_category_row(
    project_id: str,
    category_key: str,
    body: ProjectStatusCategoryUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    project = await require_editor(db, project_id, user)
    criteria_payload = body.criteria.model_dump() if body.criteria is not None else None
    try:
        row = await update_status_category(
            db,
            project,
            category_key=category_key,
            label=body.label,
            definition_text=body.definition_text,
            criteria=criteria_payload,
            is_active=body.is_active,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    project.touch()
    await db.commit()
    await db.refresh(row)
    return _serialize_category_config(row)


@router.delete(
    "/projects/{project_id}/project-status/categories/{category_key}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_status_category_row(
    project_id: str,
    category_key: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    project = await require_editor(db, project_id, user)
    try:
        await delete_status_category(db, project, category_key=category_key)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    project.touch()
    await db.commit()


@router.post(
    "/projects/{project_id}/project-status/categories/{category_key}/criteria/generate",
    response_model=ProjectStatusCriteria,
)
async def generate_status_category_criteria_row(
    project_id: str,
    category_key: str,
    body: ProjectStatusCriteriaGenerateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    project = await require_editor(db, project_id, user)
    try:
        generated = await generate_category_criteria_for_row(
            db,
            project,
            category_key=category_key,
            persist=body.persist,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if body.persist:
        project.touch()
        await db.commit()
    return ProjectStatusCriteria.model_validate(generated)
