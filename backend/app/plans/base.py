"""Base contracts for reusable plan handlers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, kw_only=True)
class PlanDefinition:
    """Metadata describing a reusable plan surface."""

    id: str
    name: str
    description: str
    primary_ui_object: str
    structure_widget_type: str
    summary_widget_type: str


class BasePlanHandler(ABC):
    """Abstract contract for plan handlers.

    Handlers own:
    - structure proposal before generation
    - full plan generation / refresh
    - widget payloads for the shared frontend plan workspace
    - plan metadata/versioning
    """

    schema_version: int = 1

    @property
    @abstractmethod
    def definition(self) -> PlanDefinition:
        """Return plan metadata."""

    @abstractmethod
    async def propose_structure(
        self,
        initiative: Any,
        chat_history: list | None = None,
    ) -> list[dict]:
        """Return the proposed plan structure before generation."""

    @abstractmethod
    async def generate_plan(
        self,
        initiative: Any,
        *,
        existing_plan: dict | None = None,
        user_request: str | None = None,
        approved_structure: list[dict] | None = None,
    ) -> dict:
        """Generate or refresh the full plan payload."""

    def attach_metadata(self, plan: dict) -> dict:
        """Attach handler-level metadata to a stored plan payload."""

        return {
            **plan,
            "plan_type": self.definition.id,
            "schema_version": self.schema_version,
        }

    def get_plan_type(self, plan: dict | None) -> str:
        """Resolve the plan type from stored payload, defaulting to this handler."""

        return (plan or {}).get("plan_type") or self.definition.id

    def build_structure_widget_data(self, structure: list[dict]) -> dict:
        """Return widget_data for the shared structure-confirm widget."""

        return {
            "planType": self.definition.id,
            "title": f"Proposed {self.definition.name} Structure",
            "subtitle": (
                f"Proposing the following {len(structure)} sections. Review and confirm to "
                "generate the full breakdown, or propose changes in the chat."
            ),
            "pendingTitle": f"Building your {self.definition.name.lower()}...",
            "pendingSubtitleTemplate": "Generating detailed breakdown for {count} sections",
            "successMessage": f"{self.definition.name} generated.",
            "footerHint": "Remove sections above · Request changes via the chat",
            "confirmLabel": "Confirm & Generate Plan",
            "minSelected": 2,
            "options": structure,
            "action": {"type": f"confirm_{self.definition.id}_structure"},
        }

    def summarize_plan(self, plan: dict) -> dict:
        """Return a generic summary payload for the shared summary widget."""

        groups = plan.get("pillars", [])
        total_items = sum(len(group.get("items", [])) for group in groups)
        required_count = sum(
            len([item for item in group.get("items", []) if item.get("classification") == "required"])
            for group in groups
        )
        return {
            "planType": self.definition.id,
            "title": self.definition.name,
            "totalItems": total_items,
            "requiredCount": required_count,
            "groups": [
                {
                    "id": group["id"],
                    "name": group["name"],
                    "itemCount": len(group.get("items", [])),
                    "requiredCount": len(
                        [item for item in group.get("items", []) if item.get("classification") == "required"]
                    ),
                    "icon": group.get("icon"),
                }
                for group in groups
            ],
        }

    def build_summary_widget_data(self, plan: dict) -> dict:
        """Return widget_data for the shared plan summary widget."""

        return {
            "planType": self.definition.id,
            "title": self.definition.name,
            "footerText": "You can edit this as needed in the diagram directly.",
            **self.summarize_plan(plan),
        }
