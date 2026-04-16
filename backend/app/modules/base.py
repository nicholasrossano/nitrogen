"""Base classes for Nitrogen module system."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable, Literal
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession

ProgressCallback = Callable[[str], Awaitable[None]]


class ExecutionModel(str, Enum):
    """How the module runs its core computation."""
    SYNC_COMPUTATION = "sync_computation"
    ASYNC_LLM_GENERATION = "async_llm_generation"


class RefinementModel(str, Enum):
    """How the user iterates on module output."""
    EDIT_AND_RECOMPUTE = "edit_and_recompute"
    FEEDBACK_AND_REGENERATE = "feedback_and_regenerate"


@dataclass
class ModuleInput:
    """Definition of an input field for a module (used in chat path)."""
    name: str
    label: str
    description: str
    input_type: Literal["text", "textarea", "number", "select", "file", "checkbox"]
    required: bool = True
    options: list[str] | None = None
    default: Any = None
    placeholder: str | None = None

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "description": self.description,
            "input_type": self.input_type,
            "required": self.required,
            "options": self.options,
            "default": self.default,
            "placeholder": self.placeholder,
        }


@dataclass
class ModuleOutput:
    """Result from running a module."""
    module_id: str
    output_type: str
    title: str
    content: dict[str, Any]
    file_path: str | None = None


@dataclass
class ModuleDefinition:
    """Metadata about a module."""
    id: str
    name: str
    description: str
    icon: str
    output_type: str
    category: str
    keywords: list[str] = field(default_factory=list)
    export_format: str | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "icon": self.icon,
            "output_type": self.output_type,
            "category": self.category,
        }


@dataclass
class FieldDef:
    """Definition of a single field within a stage.

    Used by editable_table, categorized_list, categorized_workspace, and
    record stages to drive generic rendering and validation.
    """
    name: str
    field_type: Literal["text", "number", "long_text", "select"]
    required: bool = False
    label: str | None = None
    options: list[str] | None = None
    placeholder: str | None = None

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "field_type": self.field_type,
            "required": self.required,
            "label": self.label or self.name.replace("_", " ").title(),
            "options": self.options,
            "placeholder": self.placeholder,
        }


@dataclass
class PopulationStep:
    """A single step in a stage's population pipeline.

    Steps are executed in order. Each step receives the accumulated state
    from prior steps and may extend or refine it.

    Supported types:
        start_from_predefined_rows      — module.get_predefined_rows(stage_id)
        seed_from_template              — module.get_template_items(stage_id, context)
        extract_from_project_materials  — RAG retrieval via retrieval adapter
        infer_missing_with_ai           — LLM fills gaps in existing rows/items
        adapt_with_ai_from_project_materials — LLM + RAG adapts template items
        propose_with_ai                 — LLM proposes new items from prior stage + context
        enrich_selected_item_with_ai    — LLM enriches per-record detail fields
        read_confirmed_prior_stage      — reads confirmed data from config["stage_id"]
        compute_with_module_logic       — module.compute_stage(stage_id, confirmed_stages, ctx)
        compute_with_external_tool      — module.compute_external(stage_id, tool, confirmed, ctx)
        await_user_confirmation         — terminates pipeline; sets status to "draft"
    """
    type: str
    config: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {"type": self.type, "config": self.config}


@dataclass
class StageDef:
    """Definition of a single stage in a module's workflow.

    Every module is an ordered sequence of stages. Each stage is a
    confirmable workspace with a component type, a widget renderer,
    optional field definitions, and a population pipeline.

    component types:
        table           — editable rows with typed columns (e.g. inputs table)
        list            — flat or grouped list of items
        record          — per-item detail view, driven by a prior list stage
        computed_results — opaque computed output owned by a specialized widget
    """
    id: str
    title: str
    component: Literal["table", "list", "record", "computed_results"]
    widget: str
    fields: list[FieldDef] = field(default_factory=list)
    population: list[PopulationStep] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "component": self.component,
            "widget": self.widget,
            "fields": [f.to_dict() for f in self.fields],
            "population": [p.to_dict() for p in self.population],
        }


@dataclass(kw_only=True)
class ModuleManifest(ModuleDefinition):
    """Full module contract metadata used for registry and exposure layers."""
    goal: str
    primary_ui_object: str
    export_artifact_types: list[str]
    adapter_bindings: dict[str, str]
    input_dependencies: list[str]
    produced_outputs: list[str]
    downstream_dependencies: list[str]
    assumptions_behavior: Literal["tracks", "none"]
    evidence_behavior: Literal["rag_grounded", "user_uploaded", "both", "none"]


class BaseModule(ABC):
    """Abstract base class for all Nitrogen modules.

    A module is an ordered sequence of stages, each of which is a
    confirmable workspace. The module declares its stages via stage_defs
    and implements hooks that the workflow service calls during population.
    """

    @property
    @abstractmethod
    def definition(self) -> ModuleDefinition:
        """Return module metadata."""
        pass

    @property
    @abstractmethod
    def manifest(self) -> ModuleManifest:
        """Return the full module manifest."""
        raise NotImplementedError

    @property
    @abstractmethod
    def stage_defs(self) -> list[StageDef]:
        """Ordered stage definitions for this module's workflow."""
        pass

    # ------------------------------------------------------------------ #
    # Population hooks                                                     #
    # These are called by the population step executor in the workflow     #
    # service. Override only the hooks your module needs.                  #
    # ------------------------------------------------------------------ #

    async def get_predefined_rows(
        self,
        stage_id: str,
        context: dict,
    ) -> list[dict]:
        """Return default/template rows for 'start_from_predefined_rows'.

        Each row is a dict mapping field name → value. The executor wraps
        rows in the standard item envelope with provenance tracking.
        """
        raise NotImplementedError(
            f"{self.definition.name} does not implement get_predefined_rows()"
        )

    async def generate_items_for_stage(
        self,
        stage_id: str,
        step_type: str,
        context: dict,
        prior_data: dict[str, Any],
    ) -> list[dict]:
        """Generate items for a stage during AI-assisted population.

        Called for seed_from_template, propose_with_ai, and
        adapt_with_ai_from_project_materials step types.

        stage_id: the stage being populated
        step_type: the population step type string
        context: initiative context (project_title, geography, etc.)
        prior_data: mapping of confirmed stage_id → stage data dict

        Returns a list of content dicts (one per item); the executor wraps
        them in standard item envelopes with provenance tracking.
        """
        raise NotImplementedError(
            f"{self.definition.name} does not implement generate_items_for_stage()"
        )

    async def enrich_record(
        self,
        stage_id: str,
        item_content: dict,
        existing_record: dict,
        context: dict,
    ) -> dict:
        """AI-enrich a single record for a record-component stage.

        Called when the user triggers per-item enrichment via the API.
        item_content: the item from the prior list stage
        existing_record: current record data (may be empty / partial)
        Returns a dict of enriched field name → value.
        """
        raise NotImplementedError(
            f"{self.definition.name} does not implement enrich_record()"
        )

    async def compute_stage(
        self,
        stage_id: str,
        confirmed_stages: dict[str, Any],
        context: dict,
    ) -> dict[str, Any]:
        """Run module-specific computation for 'compute_with_module_logic'.

        confirmed_stages maps stage_id → confirmed stage data dict.
        Returns the widget_data dict for a computed_results stage.
        """
        raise NotImplementedError(
            f"{self.definition.name} does not implement compute_stage()"
        )

    async def compute_external(
        self,
        stage_id: str,
        tool: str,
        confirmed_stages: dict[str, Any],
        context: dict,
    ) -> dict[str, Any]:
        """Run an external tool for 'compute_with_external_tool'.

        tool is the tool identifier string from the PopulationStep config.
        Returns the widget_data dict for a computed_results stage.
        """
        raise NotImplementedError(
            f"{self.definition.name} does not implement compute_external()"
        )

    async def generate_export(
        self,
        confirmed_stages: dict[str, Any],
        context: dict,
    ) -> bytes:
        """Generate the export artifact (DOCX/XLSX) from confirmed stage data.

        Called at download time; nothing is stored. Override in subclasses
        that support export.
        """
        raise NotImplementedError(
            f"{self.definition.name} does not implement generate_export()"
        )

    # ------------------------------------------------------------------ #
    # Chat-path methods (not part of the stage contract)                  #
    # These are used when modules are invoked from conversation context.   #
    # ------------------------------------------------------------------ #

    @property
    def required_inputs(self) -> list[ModuleInput]:
        return []

    @property
    def optional_inputs(self) -> list[ModuleInput]:
        return []

    @property
    def all_inputs(self) -> list[ModuleInput]:
        return self.required_inputs + self.optional_inputs

    @property
    def execution_model(self) -> ExecutionModel:
        return ExecutionModel.SYNC_COMPUTATION

    @property
    def refinement_model(self) -> RefinementModel:
        return RefinementModel.EDIT_AND_RECOMPUTE

    def get_questions_for_chat(self) -> list[str]:
        return [inp.description for inp in self.required_inputs]

    def validate_inputs(self, inputs: dict[str, Any]) -> tuple[bool, list[str]]:
        missing = [
            inp.label for inp in self.required_inputs
            if inp.name not in inputs or inputs[inp.name] is None
        ]
        return len(missing) == 0, missing

    def is_exportable(self, content: dict) -> bool:
        return self.definition.export_format is not None

    async def execute_from_conversation(
        self,
        conversation_text: str,
        planner_args: dict | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> tuple[str, dict]:
        """Execute module from conversation text (chat path only).

        Returns (widget_type, widget_data). Override in calculator modules
        that support chat-based execution.
        """
        raise NotImplementedError(
            f"{self.definition.name} does not support conversation-based execution"
        )
