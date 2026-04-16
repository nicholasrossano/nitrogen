"""Reusable handler for the current initiative project plan."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

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
            name="Project Plan",
            description="Structured plan for project approvals, financing, and design workstreams.",
            primary_ui_object="plan_workspace",
            structure_widget_type="plan_structure_confirm",
            summary_widget_type="plan_summary",
        )

    async def propose_structure(
        self,
        initiative,
        chat_history: list | None = None,
    ) -> list[dict]:
        return await self.service.propose_categories(initiative=initiative, chat_history=chat_history)

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
        return {
            "plan_type": self.definition.id,
            "title": "Proposed Plan Structure",
            "subtitle": (
                f"Proposing the following {len(structure)} categories. Review and confirm to "
                "generate the full breakdown, or propose changes in the chat."
            ),
            "pending_title": "Building your project plan...",
            "pending_subtitle_template": "Generating detailed breakdown for {count} categories",
            "success_message": "Plan generated. View it in the Project Plan tab.",
            "footer_hint": "Remove categories above · Request changes via the chat",
            "confirm_label": "Confirm & Generate Plan",
            "min_selected": 2,
            "options": structure,
            "action": {"type": "confirm_project_plan_categories"},
        }
