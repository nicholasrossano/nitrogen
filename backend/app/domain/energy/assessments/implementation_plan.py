"""Implementation Plan Assessment.

Stage workflow:
  1. Categories  (list / categorized_list)
  2. Activities  (list / categorized_workspace)
  3. Plan        (computed_results / implementation_plan)
"""

from __future__ import annotations

import re
from typing import Any

from app.assessments.base import (
    BaseAssessment,
    FieldDef,
    AssessmentDefinition,
    AssessmentManifest,
    PopulationStep,
    StageDef,
)
from app.assessments.retrieval import retrieve_evidence
from app.assessments.utils import infer_category_icon, llm_json


class ImplementationPlanAssessment(BaseAssessment):
    """Convert project framework data into an execution-oriented assessment workflow."""

    @property
    def definition(self) -> AssessmentDefinition:
        return AssessmentDefinition(
            id="implementation_plan",
            name="Implementation Plan",
            description="Transform your project framework into a structured implementation workplan",
            icon="Network",
            output_type="implementation_plan",
            category="planning",
            keywords=[
                "implementation",
                "execution",
                "categories",
                "workplan",
                "roadmap",
            ],
            export_format=None,
        )

    @property
    def manifest(self) -> AssessmentManifest:
        return AssessmentManifest(
            **self.definition.__dict__,
            goal="Convert an initiative's project framework into a confirmed implementation workflow grouped by workstream.",
            primary_ui_object="categorized_workspace",
            export_artifact_types=[],
            adapter_bindings={},
            input_dependencies=[],
            produced_outputs=["implementation_plan_map"],
            downstream_dependencies=[],
            assumptions_behavior="tracks",
            evidence_behavior="both",
        )

    @property
    def stage_defs(self) -> list[StageDef]:
        return [
            StageDef(
                id="phases",
                title="Categories",
                component="list",
                widget="categorized_list",
                fields=[
                    FieldDef("label", "text", required=True, label="Category"),
                    FieldDef("description", "long_text", label="Description"),
                ],
                population=[
                    PopulationStep("seed_from_template"),
                    PopulationStep("adapt_with_ai_from_project_materials"),
                    PopulationStep("await_user_confirmation"),
                ],
            ),
            StageDef(
                id="activities",
                title="Activities",
                component="list",
                widget="categorized_workspace",
                fields=[
                    FieldDef("name", "text", required=True, label="Activity"),
                    FieldDef("category", "text", required=True, label="Category"),
                    FieldDef("description", "long_text", label="Description"),
                ],
                population=[
                    PopulationStep("read_confirmed_prior_stage", {"stage_id": "phases"}),
                    PopulationStep("extract_from_project_materials"),
                    PopulationStep("propose_with_ai"),
                    PopulationStep("await_user_confirmation"),
                ],
            ),
            StageDef(
                id="plan",
                title="Plan",
                component="computed_results",
                widget="implementation_plan",
                population=[
                    PopulationStep("read_confirmed_prior_stage", {"stage_id": "activities"}),
                    PopulationStep("compute_with_assessment_logic"),
                ],
            ),
        ]

    async def generate_items_for_stage(
        self,
        stage_id: str,
        step_type: str,
        context: dict,
        prior_data: dict[str, Any],
    ) -> list[dict]:
        project_plan = context.get("project_plan")

        if stage_id == "phases":
            if step_type == "seed_from_template":
                return self._build_categories_from_project_plan(project_plan)
            if step_type == "adapt_with_ai_from_project_materials":
                return await self._propose_categories(context, project_plan)
            return []

        if stage_id == "activities":
            confirmed_categories = (prior_data.get("phases") or {}).get("data", {}).get("items", [])
            if step_type == "propose_with_ai":
                return await self._propose_activities(context, confirmed_categories, project_plan)
            return []

        return []

    async def compute_stage(
        self,
        stage_id: str,
        confirmed_stages: dict[str, Any],
        context: dict,
    ) -> dict[str, Any]:
        if stage_id != "plan":
            raise ValueError(f"compute_stage called for unexpected stage '{stage_id}'")

        category_items = (confirmed_stages.get("phases") or {}).get("data", {}).get("items", [])
        activity_items = (confirmed_stages.get("activities") or {}).get("data", {}).get("items", [])

        palette = [
            "#005e72",
            "#6b3fa0",
            "#1a7340",
            "#c05621",
            "#1d4ed8",
            "#92400e",
            "#065f46",
            "#7e22ce",
        ]

        groups: list[dict[str, Any]] = []
        for idx, category_item in enumerate(category_items):
            category_content = category_item.get("content", {})
            category_label = (category_content.get("label") or "").strip()
            if not category_label:
                continue

            category_icon = category_content.get("icon") or infer_category_icon(category_label)
            category_color = palette[idx % len(palette)]
            normalized_label = self._normalize_key(category_label)
            pillar_id = (category_content.get("pillar_id") or "").strip()

            category_activities = []
            for item in activity_items:
                content = item.get("content", {})
                activity_category = (content.get("category") or "").strip()
                activity_pillar_id = (content.get("pillar_id") or "").strip()
                if (
                    self._normalize_key(activity_category) != normalized_label
                    and not (pillar_id and activity_pillar_id == pillar_id)
                ):
                    continue

                category_activities.append(
                    {
                        "id": item.get("id", ""),
                        "name": (content.get("name") or "").strip(),
                        "description": (content.get("description") or content.get("rationale") or "").strip(),
                        "category": category_label,
                        "item_type": content.get("item_type", "deliverable"),
                        "classification": content.get("classification", "unknown"),
                        "status": self._resolve_activity_status(content, item),
                        "phase": content.get("phase"),
                        "phase_order": content.get("phase_order"),
                        "supports": content.get("supports", []),
                        "depends_on": content.get("depends_on", []),
                        "provenance": item.get("provenance", {}),
                    }
                )

            groups.append(
                {
                    "id": category_item.get("id", ""),
                    "label": category_label,
                    "icon": category_icon,
                    "color": category_color,
                    "items": category_activities,
                }
            )

        return {"groups": groups, "assessment_id": "implementation_plan"}

    def _build_categories_from_project_plan(self, project_plan: Any) -> list[dict[str, Any]]:
        if not isinstance(project_plan, dict):
            return []

        items: list[dict[str, Any]] = []
        pillars = project_plan.get("pillars")
        if isinstance(pillars, list):
            for pillar in pillars:
                if not isinstance(pillar, dict):
                    continue
                name = (pillar.get("name") or "").strip()
                if not name:
                    continue
                items.append(
                    {
                        "label": name,
                        "description": (pillar.get("summary") or "").strip(),
                        "pillar_id": (pillar.get("id") or "").strip(),
                        "icon": (pillar.get("icon") or infer_category_icon(name)),
                    }
                )

        if items:
            return items

        phases = project_plan.get("phases")
        if not isinstance(phases, list):
            return []

        for phase in phases:
            if not isinstance(phase, dict):
                continue
            name = (phase.get("name") or "").strip()
            if not name:
                continue
            items.append(
                {
                    "label": name,
                    "description": (phase.get("description") or "").strip(),
                    "phase_id": (phase.get("id") or "").strip(),
                    "icon": infer_category_icon(name),
                }
            )
        return items

    async def _propose_categories(
        self,
        context: dict[str, Any],
        project_plan: Any,
    ) -> list[dict[str, Any]]:
        from app.services.project_plan import CATEGORY_PROPOSAL_SYSTEM_PROMPT

        framework_outline = self._summarize_project_plan(project_plan)
        data = await llm_json(
            system=(
                CATEGORY_PROPOSAL_SYSTEM_PROMPT
                + "\n\nReturn valid JSON with key 'categories'."
            context=context,
            ),
            user_msg=(
                f"Project: {context.get('project_title', 'Unknown')}\n"
                f"Type: {context.get('project_type', '')}\n"
                f"Geography: {context.get('geography', '')}\n"
                f"Description: {context.get('project_description', '')}\n\n"
                f"Existing framework (if any):\n{framework_outline}"
            ),
        )
        categories = data.get("categories", [])
        output = []
        for category in categories:
            if not isinstance(category, dict):
                continue
            label = (category.get("name") or category.get("label") or "").strip()
            if not label:
                continue
            output.append(
                {
                    "label": label,
                    "description": (category.get("summary") or category.get("description") or "").strip(),
                    "pillar_id": (category.get("id") or "").strip(),
                    "icon": (category.get("icon") or infer_category_icon(label)),
                }
            )
        return output

    async def _propose_activities(
        self,
        context: dict[str, Any],
        confirmed_category_items: list[dict[str, Any]],
        project_plan: Any,
    ) -> list[dict[str, Any]]:
        categories = [
            item.get("content", {}).get("label", "").strip()
            for item in confirmed_category_items
            if item.get("content", {}).get("label", "").strip()
        ]
        category_descriptions = {
            item.get("content", {}).get("label", "").strip(): item.get("content", {}).get("description", "").strip()
            for item in confirmed_category_items
            if item.get("content", {}).get("label", "").strip()
        }
        if not categories:
            return []

        category_list = "\n".join(
            f"- {label}: {category_descriptions.get(label, '')}".rstrip()
            for label in categories
        )
        framework_outline = self._summarize_project_plan(project_plan)
        framework_items_by_category = self._summarize_framework_items_by_category(project_plan, categories)
        evidence_block = await self._implementation_evidence_block(context, categories, framework_items_by_category)
        data = await llm_json(
            system=(
                "You are converting a sustainable development project framework into an implementation assessment. "
                "For each category listed, propose specific implementation activities for THIS project. "
                "These should be concrete work products, implementation packages, submissions, approvals, studies, "
                "partnership instruments, procurement artifacts, deployment tasks, operational readiness steps, or analysis outputs. "
                "Use the existing framework as the starting point, but adapt it into implementation-specific activities "
                "based on the actual project description, geography, and retrieved evidence. "
                "Avoid generic boilerplate like broad 'capacity building' or 'strategy development' unless the project context clearly warrants it. "
                "Do not skip categories. Every category must receive at least 2 activities. "
                "Return JSON with key 'activities' as a flat list with fields: "
                "name, category (must exactly match one listed category), description, "
                "item_type (deliverable|assessment), classification (required|optional|unknown), "
                "status (not_started|in_progress|complete), and optional phase and phase_order. "
                "Descriptions should explain why the activity is needed for this specific project."
            context=context,
            ),
            user_msg=(
                f"Project: {context.get('project_title', 'Unknown')}\n"
                f"Type: {context.get('project_type', '')}\n"
                f"Geography: {context.get('geography', '')}\n"
                f"Description: {context.get('project_description', '')}\n\n"
                f"Confirmed categories:\n{category_list}\n\n"
                f"Existing framework (if any):\n{framework_outline}\n\n"
                f"Framework items by category:\n{framework_items_by_category}\n"
                f"{evidence_block}\n\n"
                "Provide 2-6 activities per category."
            ),
        )

        activities_by_category = self._bucket_activities(data.get("activities", []), categories)
        min_per_category = 2
        underfilled = [category for category in categories if len(activities_by_category.get(category, [])) < min_per_category]
        if underfilled:
            missing = "\n".join(
                f"- {category}: need at least {min_per_category - len(activities_by_category.get(category, []))} more"
                for category in underfilled
            )
            existing = "\n".join(
                f"- {category}: {', '.join(item['name'] for item in activities_by_category.get(category, [])) or '(none)'}"
                for category in categories
            )
            refill = await llm_json(
                system=(
                    "You are filling only missing implementation activities for underfilled categories. "
                    "Return JSON with key 'activities' as a flat list. "
                    "Each activity must include name, category, description, item_type, classification, and status. "
                    "Category must exactly match one listed category. Avoid generic boilerplate."
                context=context,
                ),
                user_msg=(
                    f"Project: {context.get('project_title', 'Unknown')}\n"
                    f"Type: {context.get('project_type', '')}\n"
                    f"Geography: {context.get('geography', '')}\n"
                    f"Description: {context.get('project_description', '')}\n\n"
                    f"All categories:\n{category_list}\n\n"
                    f"Framework items by category:\n{framework_items_by_category}\n"
                    f"{evidence_block}\n\n"
                    f"Existing activities by category:\n{existing}\n\n"
                    f"Underfilled categories:\n{missing}"
                ),
            )
            refill_bucket = self._bucket_activities(refill.get("activities", []), categories)
            for category in categories:
                existing_names = {item["name"].strip().lower() for item in activities_by_category.get(category, [])}
                for activity in refill_bucket.get(category, []):
                    key = activity["name"].strip().lower()
                    if key not in existing_names:
                        activities_by_category.setdefault(category, []).append(activity)
                        existing_names.add(key)

        output: list[dict[str, Any]] = []
        category_pillar_ids = self._category_pillar_ids(confirmed_category_items)
        for category in categories:
            items = activities_by_category.get(category, [])
            for activity in items:
                output.append(
                    {
                        "name": activity["name"],
                        "category": category,
                        "description": activity.get("description", ""),
                        "pillar_id": category_pillar_ids.get(self._normalize_key(category)),
                        "item_type": self._normalize_item_type(activity.get("item_type")),
                        "classification": self._normalize_classification(activity.get("classification")),
                        "status": self._normalize_status(activity.get("status")),
                        "phase": activity.get("phase") or None,
                        "phase_order": self._safe_int(activity.get("phase_order")),
                        "supports": self._normalize_string_list(activity.get("supports")),
                        "depends_on": self._normalize_string_list(activity.get("depends_on")),
                    }
                )
        return output

    def _category_lookup(self, category_items: list[dict[str, Any]]) -> dict[str, str]:
        lookup: dict[str, str] = {}
        for item in category_items:
            content = item.get("content", {})
            label = (content.get("label") or "").strip()
            if not label:
                continue
            lookup[self._normalize_key(label)] = label
            pillar_id = (content.get("pillar_id") or "").strip()
            if pillar_id:
                lookup[self._normalize_key(pillar_id)] = label
        return lookup

    def _category_pillar_ids(self, category_items: list[dict[str, Any]]) -> dict[str, str]:
        lookup: dict[str, str] = {}
        for item in category_items:
            content = item.get("content", {})
            label = (content.get("label") or "").strip()
            pillar_id = (content.get("pillar_id") or "").strip()
            if label and pillar_id:
                lookup[self._normalize_key(label)] = pillar_id
        return lookup

    @staticmethod
    def _normalize_key(value: str) -> str:
        return re.sub(r"[^a-z0-9]+", "_", (value or "").strip().lower()).strip("_")

    def _bucket_activities(self, raw_activities: list[dict[str, Any]], categories: list[str]) -> dict[str, list[dict[str, Any]]]:
        buckets: dict[str, list[dict[str, Any]]] = {category: [] for category in categories}
        seen: set[tuple[str, str]] = set()

        for activity in raw_activities or []:
            if not isinstance(activity, dict):
                continue
            name = (activity.get("name") or "").strip()
            category = self._normalize_category(activity.get("category", ""), categories)
            if not name or not category:
                continue
            dedupe_key = (category, name.lower())
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            buckets[category].append(
                {
                    "name": name,
                    "category": category,
                    "description": (activity.get("description") or "").strip(),
                    "item_type": activity.get("item_type"),
                    "classification": activity.get("classification"),
                    "status": activity.get("status"),
                    "phase": (activity.get("phase") or "").strip() or None,
                    "phase_order": activity.get("phase_order"),
                    "supports": self._normalize_string_list(activity.get("supports")),
                    "depends_on": self._normalize_string_list(activity.get("depends_on")),
                }
            )

        return buckets

    def _normalize_category(self, raw_category: str, categories: list[str]) -> str:
        raw = (raw_category or "").strip()
        if not raw:
            return ""
        if raw in categories:
            return raw

        normalized_map = {self._normalize_key(category): category for category in categories}
        return normalized_map.get(self._normalize_key(raw), "")

    def _summarize_project_plan(self, project_plan: Any) -> str:
        if not isinstance(project_plan, dict):
            return "(No existing framework.)"

        pillars = project_plan.get("pillars")
        if not isinstance(pillars, list) or not pillars:
            return "(No existing framework.)"

        sections: list[str] = []
        for pillar in pillars:
            if not isinstance(pillar, dict):
                continue
            name = (pillar.get("name") or "").strip()
            if not name:
                continue
            items = []
            for item in pillar.get("items", [])[:6]:
                if not isinstance(item, dict):
                    continue
                title = (item.get("title") or "").strip()
                if title:
                    items.append(f"- {title}")
            summary = (pillar.get("summary") or "").strip()
            block = f"{name}: {summary}".strip(": ")
            if items:
                block += "\n" + "\n".join(items)
            sections.append(block)
        return "\n\n".join(sections) if sections else "(No existing framework.)"

    def _summarize_framework_items_by_category(self, project_plan: Any, categories: list[str]) -> str:
        if not isinstance(project_plan, dict):
            return "(No framework items available.)"

        pillars = project_plan.get("pillars")
        if not isinstance(pillars, list) or not pillars:
            return "(No framework items available.)"

        category_map = {self._normalize_key(category): category for category in categories}
        sections: list[str] = []
        for pillar in pillars:
            if not isinstance(pillar, dict):
                continue
            pillar_name = (pillar.get("name") or "").strip()
            if not pillar_name:
                continue
            category = category_map.get(self._normalize_key(pillar_name), pillar_name)
            item_lines: list[str] = []
            for item in pillar.get("items", [])[:10]:
                if not isinstance(item, dict):
                    continue
                title = (item.get("title") or "").strip()
                if not title:
                    continue
                rationale = (item.get("rationale") or "").strip()
                phase = (item.get("phase") or "").strip()
                item_type = self._normalize_item_type(item.get("item_type"))
                detail = f"- {title} [{item_type}]"
                if phase:
                    detail += f" (phase: {phase})"
                if rationale:
                    detail += f": {rationale}"
                item_lines.append(detail)
            if item_lines:
                sections.append(f"{category}\n" + "\n".join(item_lines))
        return "\n\n".join(sections) if sections else "(No framework items available.)"

    async def _implementation_evidence_block(
        self,
        context: dict[str, Any],
        categories: list[str],
        framework_items_by_category: str,
    ) -> str:
        geography = context.get("geography", "")
        project_type = context.get("project_type", "")
        project_title = context.get("project_title", "")
        project_description = context.get("project_description", "")

        queries = []
        for category in categories[:4]:
            parts = [project_title, project_type, geography, category, "implementation requirements"]
            query = " ".join(part for part in parts if part).strip()
            if query:
                queries.append(query)

        description_snippet = " ".join(str(project_description).split())[:180]
        if description_snippet:
            queries.append(f"{description_snippet} {geography} {project_type} implementation deliverables".strip())

        framework_lines = [
            line[2:]
            for line in framework_items_by_category.splitlines()
            if line.startswith("- ")
        ][:4]
        for item_title in framework_lines:
            query = " ".join(part for part in [item_title, geography, project_type] if part).strip()
            if query:
                queries.append(query)

        if not queries:
            return "Retrieved evidence:\n(None.)"

        context_str, _citations = await retrieve_evidence(queries, None, None, max_facts=10)
        if not context_str:
            return "Retrieved evidence:\n(None.)"
        return f"Retrieved evidence:\n{context_str}"

    @staticmethod
    def _normalize_item_type(value: Any) -> str:
        return "assessment" if str(value).strip().lower() == "assessment" else "deliverable"

    @staticmethod
    def _normalize_classification(value: Any) -> str:
        normalized = str(value).strip().lower()
        if normalized in {"required", "optional", "unknown"}:
            return normalized
        return "unknown"

    @staticmethod
    def _normalize_status(value: Any) -> str:
        normalized = str(value).strip().lower()
        if normalized in {"not_started", "in_progress", "complete"}:
            return normalized
        return "not_started"

    def _resolve_activity_status(self, content: dict[str, Any], item: dict[str, Any]) -> str:
        """Only trust completion state when explicitly user-edited.

        The implementation plan keeps status fields so UI controls can be enabled
        per-assessment, but we suppress model-inferred completion until we have
        stronger completion semantics.
        """
        status = self._normalize_status(content.get("status"))
        provenance = item.get("provenance", {}) if isinstance(item, dict) else {}
        derivation = str((provenance or {}).get("derivation", "")).strip().lower()
        if derivation == "user_edited":
            return status
        return "not_started"

    @staticmethod
    def _normalize_string_list(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        result = []
        for item in value:
            text = str(item).strip()
            if text:
                result.append(text)
        return result

    @staticmethod
    def _safe_int(value: Any) -> int | None:
        try:
            if value is None:
                return None
            return int(value)
        except (TypeError, ValueError):
            return None
