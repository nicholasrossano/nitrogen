"""Reusable handler for the current initiative project plan."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules import get_module_registry
from app.plans.base import BasePlanHandler, PlanDefinition
from app.services.project_plan import ProjectPlanService


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
        registry = get_module_registry()

        if initiative.selected_tools:
            selected = []
            for module_id in initiative.selected_tools:
                module = registry.get_module(module_id)
                if module:
                    selected.append(
                        {
                            "tool": module.definition.to_dict(),
                            "confidence": 1.0,
                            "recommended": True,
                        }
                    )
            if selected:
                return selected

        recommendations = registry.recommend_modules(
            project_description=initiative.project_description or initiative.title or "",
            project_type=initiative.project_type,
        )

        return [
            {
                "tool": module.definition.to_dict(),
                "confidence": confidence,
                "recommended": confidence >= 0.35,
            }
            for module, confidence in recommendations
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
            "title": "Recommended Framework Modules",
            "subtitle": (
                "I've mapped the modules that look most relevant for this project. Remove any "
                "that do not fit, then confirm to set up the framework plan."
            ),
            "pendingTitle": "Building your framework...",
            "pendingSubtitle": (
                f"Setting up {recommended_count or len(structure)} recommended module"
                f"{'' if (recommended_count or len(structure)) == 1 else 's'}"
            ),
            "successMessage": "Framework generated. View it in the Framework tab.",
            "footerHint": "Remove modules above or request changes in chat",
            "confirmLabel": "Confirm Framework Modules",
            "recommendations": structure,
        }
