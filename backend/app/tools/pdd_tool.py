"""PDD (Project Design Document) tool — minimal BaseTool wrapper for registry integration.

The actual multi-step PDD authoring logic lives in app.services.pdd_service.PDDService.
This tool class exists so the PDD appears in the tool registry and can be triggered
via tile / tool hint in the Generate flow.
"""

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.tools.base import (
    BaseTool,
    ExecutionModel,
    RefinementModel,
    ReviewStrategy,
    ToolDefinition,
    ToolInput,
    ToolOutput,
    ToolAlignment,
    ProgressCallback,
)


class PDDTool(BaseTool):
    """Guided Project Design Document creation from project materials."""

    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            id="pdd",
            name="Project Design Document",
            description="Build a PDD from project materials with guided, section-by-section authoring",
            icon="FileText",
            output_type="pdd",
            category="documentation",
            keywords=["pdd", "project design", "design document", "carbon", "methodology"],
        )

    @property
    def review_strategy(self) -> ReviewStrategy:
        return ReviewStrategy.NONE

    @property
    def execution_model(self) -> ExecutionModel:
        return ExecutionModel.ASYNC_LLM_GENERATION

    @property
    def refinement_model(self) -> RefinementModel:
        return RefinementModel.FEEDBACK_AND_REGENERATE

    @property
    def required_inputs(self) -> list[ToolInput]:
        return []

    async def execute(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        inputs: dict[str, Any],
        include_corpus: bool = True,
        alignment: ToolAlignment | None = None,
    ) -> ToolOutput:
        raise NotImplementedError(
            "PDD uses its own multi-step flow via PDDService. "
            "Trigger via the /initiatives/{id}/pdd endpoints instead."
        )

    async def execute_from_conversation(
        self,
        conversation_text: str,
        planner_args: dict | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> tuple[str, dict]:
        """Return a pdd_workspace widget stub that the frontend uses to bootstrap the flow."""
        return "pdd_workspace", {
            "status": "pending",
            "message": "Starting PDD workspace...",
        }
