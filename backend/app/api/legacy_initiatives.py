"""Legacy /initiatives/* route aliases delegating to canonical project handlers."""

from __future__ import annotations

from fastapi import APIRouter, status

from app.api import (
    assessment_catalog,
    assumptions,
    evidence,
    exports,
    google_drive,
    project_status,
    project_materials,
    project_plan,
    projects,
    shares,
)

router = APIRouter(include_in_schema=False)


def _alias(path: str, handler, methods: list[str], **kwargs):
    router.add_api_route(path, handler, methods=methods, **kwargs)


# Core project CRUD and assessments
_alias("/initiatives", projects.list_projects, ["GET"], response_model=list[dict])
_alias("/initiatives", projects.create_project, ["POST"], status_code=status.HTTP_201_CREATED)
_alias("/initiatives/{project_id}", projects.get_project, ["GET"])
_alias("/initiatives/{project_id}", projects.update_project, ["PATCH"])
_alias("/initiatives/{project_id}", projects.archive_project, ["DELETE"])
_alias("/initiatives/{project_id}/confirm", projects.confirm_project, ["POST"])
_alias("/initiatives/{project_id}/overview", projects.generate_overview, ["POST"])
_alias("/initiatives/{project_id}/restore", projects.restore_project, ["POST"])
_alias("/initiatives/{project_id}/permanent", projects.permanently_delete_project, ["DELETE"])
_alias("/initiatives/{project_id}/assessments", projects.list_assessment_instances, ["GET"])
_alias("/initiatives/{project_id}/assessments", projects.create_assessment_instance, ["POST"])
_alias(
    "/initiatives/{project_id}/assessments/{instance_id}",
    projects.archive_assessment_instance,
    ["DELETE"],
)
_alias(
    "/initiatives/{project_id}/assessments/{instance_id}/restore",
    projects.restore_assessment_instance,
    ["POST"],
)
_alias(
    "/initiatives/{project_id}/assessments/{instance_id}/permanent",
    projects.permanently_delete_assessment_instance,
    ["DELETE"],
)

# Evidence
_alias("/initiatives/{project_id}/evidence", evidence.upload_evidence, ["POST"])
_alias("/initiatives/{project_id}/evidence/text", evidence.paste_evidence_text, ["POST"])
_alias("/initiatives/{project_id}/evidence", evidence.list_evidence, ["GET"])

# Assessment catalog / workflow inputs
_alias(
    "/initiatives/{project_id}/recommended-tools",
    assessment_catalog.get_recommended_tools,
    ["GET"],
)
_alias("/initiatives/{project_id}/select-tools", assessment_catalog.select_tools, ["POST"])
_alias("/initiatives/{project_id}/tool-inputs", assessment_catalog.get_tool_inputs, ["GET"])
_alias("/initiatives/{project_id}/update-inputs", assessment_catalog.update_tool_inputs, ["POST"])
_alias(
    "/initiatives/{project_id}/proceed-to-review",
    assessment_catalog.proceed_to_review,
    ["POST"],
)

# Assumptions
_alias("/initiatives/{project_id}/assumptions/summary", assumptions.get_assumptions_summary, ["GET"])
_alias("/initiatives/{project_id}/assumptions", assumptions.get_assumptions, ["GET"])
_alias("/initiatives/{project_id}/assumptions/resolve", assumptions.resolve_assumption, ["GET"])
_alias("/initiatives/{project_id}/assumptions", assumptions.create_assumption, ["POST"])
_alias("/initiatives/{project_id}/assumptions/refresh", assumptions.refresh_assumptions, ["POST"])

# Shares
_alias("/initiatives/{project_id}/shares", shares.list_shares, ["GET"])
_alias("/initiatives/{project_id}/shares", shares.create_share, ["POST"])
_alias("/initiatives/{project_id}/shares/{share_id}", shares.update_share, ["PATCH"])
_alias("/initiatives/{project_id}/shares/{share_id}", shares.delete_share, ["DELETE"])

# Google Drive
_alias("/initiatives/{project_id}/drive/import", google_drive.import_from_drive, ["POST"])
_alias("/initiatives/{project_id}/drive/linked", google_drive.list_drive_linked_files, ["GET"])
_alias(
    "/initiatives/{project_id}/drive/linked/{linked_id}",
    google_drive.unlink_drive_file,
    ["DELETE"],
)
_alias("/initiatives/{project_id}/drive/sync", google_drive.sync_drive_files, ["POST"])

# Project materials
_alias("/initiatives/{project_id}/materials", project_materials.upload_material, ["POST"])
_alias("/initiatives/{project_id}/materials", project_materials.list_materials, ["GET"])
_alias("/initiatives/{project_id}/files", project_materials.list_project_files, ["GET"])
_alias(
    "/initiatives/{project_id}/deliverables/{tool_id}",
    project_materials.delete_deliverable,
    ["DELETE"],
)

# Project plan
_alias("/initiatives/{project_id}/project-plan", project_plan.get_project_plan, ["GET"])
_alias("/initiatives/{project_id}/project-plan", project_plan.generate_project_plan, ["POST"])
_alias(
    "/initiatives/{project_id}/project-plan/items/{item_id}/status",
    project_plan.update_plan_item_status,
    ["PATCH"],
)
_alias(
    "/initiatives/{project_id}/project-plan/items/{item_id}",
    project_plan.delete_plan_item,
    ["DELETE"],
)
_alias(
    "/initiatives/{project_id}/project-plan/items/{item_id}/elements/{element_index}",
    project_plan.delete_plan_element,
    ["DELETE"],
)
_alias(
    "/initiatives/{project_id}/project-plan/pillars/{pillar_id}/items",
    project_plan.add_plan_item,
    ["POST"],
)
_alias(
    "/initiatives/{project_id}/project-plan/items/{item_id}/deep-dive",
    project_plan.deep_dive_plan_item,
    ["POST"],
)

# Project status
_alias("/initiatives/{project_id}/project-status", project_status.get_project_status, ["GET"])
_alias(
    "/initiatives/{project_id}/project-status/refresh",
    project_status.refresh_project_status_rows,
    ["POST"],
)
_alias(
    "/initiatives/{project_id}/project-status/{category_key}/override",
    project_status.override_project_status_category,
    ["POST"],
)
_alias(
    "/initiatives/{project_id}/project-status/categories",
    project_status.list_status_categories,
    ["GET"],
)
_alias(
    "/initiatives/{project_id}/project-status/categories",
    project_status.create_status_category_row,
    ["POST"],
)
_alias(
    "/initiatives/{project_id}/project-status/categories/{category_key}",
    project_status.update_status_category_row,
    ["PATCH"],
)
_alias(
    "/initiatives/{project_id}/project-status/categories/{category_key}",
    project_status.delete_status_category_row,
    ["DELETE"],
)
_alias(
    "/initiatives/{project_id}/project-status/categories/{category_key}/criteria/generate",
    project_status.generate_status_category_criteria_row,
    ["POST"],
)
# Legacy project-health aliases
_alias("/initiatives/{project_id}/project-health", project_status.get_project_status, ["GET"])
_alias(
    "/initiatives/{project_id}/project-health/refresh",
    project_status.refresh_project_status_rows,
    ["POST"],
)

# Exports
_alias("/initiatives/{project_id}/export", exports.export_memo, ["POST"])
_alias(
    "/initiatives/{project_id}/deliverables/{tool_id}/export",
    exports.export_deliverable,
    ["GET"],
)
