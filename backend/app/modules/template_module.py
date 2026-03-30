"""Template Fill Tool — analyse a user-uploaded template (DOCX/XLSX), extract
requirements, cross-reference against project materials, and surface gaps."""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import get_settings
from app.modules.base import (
    BaseModule,
    ExecutionModel,
    ProgressCallback,
    RefinementModel,
    ReviewStrategy,
    ModuleDefinition,
    ModuleInput,
    ModuleOutput,
)

settings = get_settings()
logger = logging.getLogger(__name__)


class TemplateFillTool(BaseModule):
    """Analyse an uploaded template and produce a requirements widget."""

    @property
    def definition(self) -> ModuleDefinition:
        return ModuleDefinition(
            id="template_fill",
            name="From Template",
            description="Complete a document template using project materials",
            icon="FileUp",
            output_type="template",
            category="documentation",
            keywords=["template", "form", "fill", "complete", "docx", "xlsx"],
        )  # no export_format — templates use ProjectMaterial storage with their own download route

    @property
    def required_inputs(self) -> list[ModuleInput]:
        return [
            ModuleInput(
                name="template_id",
                label="Template file",
                description="The uploaded template to analyse",
                input_type="file",
            ),
        ]

    @property
    def review_strategy(self) -> ReviewStrategy:
        return ReviewStrategy.INPUT_REVIEW

    @property
    def execution_model(self) -> ExecutionModel:
        return ExecutionModel.ASYNC_LLM_GENERATION

    @property
    def refinement_model(self) -> RefinementModel:
        return RefinementModel.FEEDBACK_AND_REGENERATE

    async def execute(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        inputs: dict[str, Any],
        include_corpus: bool = True,
        alignment=None,
    ) -> ModuleOutput:
        raise NotImplementedError("Use execute_from_template instead")

    async def execute_from_template(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        template_id: UUID,
        on_progress: ProgressCallback | None = None,
    ) -> tuple[str, dict]:
        """Full pipeline: parse → extract requirements → cross-reference → return
        widget data for the template_requirements widget."""

        from app.core.storage import get_uploads_storage
        from app.models.project_material import ProjectMaterial
        from app.services.template_parser import TemplateParserService
        from app.services.template_analysis import TemplateAnalysisService

        result = await db.execute(
            select(ProjectMaterial).where(
                ProjectMaterial.id == template_id,
                ProjectMaterial.initiative_id == initiative_id,
            )
        )
        material = result.scalar_one_or_none()
        if not material or not material.storage_path:
            raise ValueError("Template not found")

        storage = get_uploads_storage()
        template_bytes = await storage.load(material.storage_path)

        if on_progress:
            await on_progress("Parsing template structure...")

        parser = TemplateParserService()
        is_xlsx = material.file_type == "template_xlsx"
        structure = (
            parser.parse_xlsx_template(template_bytes)
            if is_xlsx
            else parser.parse_docx_template(template_bytes)
        )

        total_fields = sum(len(s.fields) for s in structure.sections)
        logger.info(
            "Template parsed: %d sections, %d pre-detected fields, raw_text=%d chars",
            len(structure.sections), total_fields, len(structure.raw_text or ""),
        )

        analysis = TemplateAnalysisService()
        requirements, form_summary = await analysis.extract_requirements(structure, on_progress=on_progress)
        logger.info("LLM extracted %d requirements", len(requirements))
        for r in requirements[:10]:
            logger.info("  Req: '%s' [%s] calculated=%s", r.label[:60], r.field_type, r.is_calculated)
        statuses = await analysis.cross_reference_requirements(
            db, initiative_id, requirements, on_progress=on_progress,
        )

        if on_progress:
            supported = sum(1 for s in statuses if s.status == "supported")
            total = len(statuses)
            await on_progress(f"Found {supported}/{total} requirements already supported by project materials.")

        widget_data = {
            "template_id": str(template_id),
            "filename": material.filename,
            "file_type": "xlsx" if is_xlsx else "docx",
            "form_summary": form_summary,
            "requirements": [s.to_dict() for s in statuses],
            "summary": {
                "total": len(statuses),
                "supported": sum(1 for s in statuses if s.status == "supported"),
                "partial": sum(1 for s in statuses if s.status == "partially_supported"),
                "missing": sum(1 for s in statuses if s.status == "missing"),
                "needs_confirmation": sum(1 for s in statuses if s.status == "needs_confirmation"),
            },
        }

        return "template_requirements", widget_data

    async def execute_from_conversation(
        self,
        conversation_text: str,
        planner_args: dict | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> tuple[str, dict]:
        raise NotImplementedError(
            "TemplateFillTool requires DB access — use execute_from_template"
        )
