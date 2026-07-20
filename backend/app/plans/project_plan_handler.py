"""Reusable handler for the current initiative project plan."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.assessments import get_assessment_registry
from app.assessments.recommendation import load_materials_preview, recommend_for_project
from app.plans.base import BasePlanHandler, PlanDefinition
from app.services.project_plan import ProjectPlanService


def _chat_summary(chat_history: list | None, *, max_messages: int = 6) -> str | None:
    if not chat_history:
        return None
    lines: list[str] = []
    for message in chat_history[-max_messages:]:
        if isinstance(message, dict):
            role = str(message.get("role") or "user").strip()
            content = str(message.get("content") or "").strip()
        else:
            role = str(getattr(message, "role", "user") or "user").strip()
            content = str(getattr(message, "content", "") or "").strip()
        if not content:
            continue
        lines.append(f"{role}: {content[:400]}")
    return "\n".join(lines) if lines else None


class ProjectPlanHandler(BasePlanHandler):
    """Adapter that exposes the legacy project plan as a reusable plan handler."""

    schema_version = 2

    def __init__(self, db: AsyncSession, user_id: str | None = None):
        self.db = db
        self.user_id = user_id
        self.service = ProjectPlanService(db, user_id=user_id)

    @property
    def definition(self) -> PlanDefinition:
        return PlanDefinition(
            id="project_plan",
            name="Framework",
            description="Structured plan for project approvals, financing, and design workstreams.",
            primary_ui_object="plan_workspace",
            structure_widget_type="tool_checklist",
            summary_widget_type="plan_summary",
        )

    async def propose_structure(
        self,
        initiative,
        chat_history: list | None = None,
    ) -> list[dict]:
        registry = get_assessment_registry()

        if initiative.selected_tools:
            selected = []
            for assessment_id in initiative.selected_tools:
                assessment = registry.get_assessment(assessment_id)
                if assessment:
                    selected.append(
                        {
                            "tool": assessment.definition.to_dict(),
                            "confidence": 1.0,
                            "recommended": True,
                        }
                    )
            if selected:
                return selected

        # When the user uploaded files, wait for lightweight extraction so
        # materials previews can inform relevance (not just timing).
        from app.services.evidence_processor import await_lightweight_readiness

        await await_lightweight_readiness(initiative.id)

        materials_preview = await load_materials_preview(self.db, initiative.id)
        rows = await recommend_for_project(
            assessments=registry.get_all_assessments(),
            project_title=initiative.title or "",
            project_description=initiative.project_description or "",
            project_type=initiative.project_type,
            materials_preview=materials_preview,
            chat_summary=_chat_summary(chat_history),
            user_id=self.user_id,
            db=self.db,
            use_llm=True,
        )

        # Checklist shows only the relevance-gated proposals (not the full catalog).
        return [
            {
                "tool": assessment.definition.to_dict(),
                "confidence": confidence,
                "recommended": True,
            }
            for assessment, confidence, recommended in rows
            if recommended
        ]

    async def generate_plan(
        self,
        initiative,
        *,
        existing_plan: dict | None = None,
        user_request: str | None = None,
        approved_structure: list[dict] | None = None,
    ) -> dict:
        plan = await self.service.generate(
            initiative=initiative,
            existing_plan=existing_plan,
            user_request=user_request,
            approved_categories=approved_structure,
        )
        return self.attach_metadata(plan)

    def build_structure_widget_data(self, structure: list[dict]) -> dict:
        recommended_count = len([item for item in structure if item.get("recommended")])
        return {
            "title": "Recommended Framework Assessments",
            "subtitle": (
                "I've mapped the assessments that look most relevant for this project. Remove any "
                "that do not fit, then confirm to set up the framework plan."
            ),
            "pendingTitle": "Building your framework...",
            "pendingSubtitle": (
                f"Setting up {recommended_count or len(structure)} recommended assessment"
                f"{'' if (recommended_count or len(structure)) == 1 else 's'}"
            ),
            "successMessage": "Framework generated. View it in the Framework tab.",
            "footerHint": "Remove assessments above or request changes in chat",
            "confirmLabel": "Confirm Framework Assessments",
            "recommendations": structure,
        }
