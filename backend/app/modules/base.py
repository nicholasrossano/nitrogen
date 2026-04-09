"""Base classes for Nitrogen tools."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable, Literal
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession

ProgressCallback = Callable[[str], Awaitable[None]]


class ReviewStrategy(str, Enum):
    """How the tool handles pre-execution review.

    Both INPUT_REVIEW and OUTLINE_REVIEW present assumptions for the user
    to inspect — they're the same UX pattern with different content.
    """
    NONE = "none"
    INPUT_REVIEW = "input_review"
    OUTLINE_REVIEW = "outline_review"


class ExecutionModel(str, Enum):
    """How the tool runs its core computation."""
    SYNC_COMPUTATION = "sync_computation"
    ASYNC_LLM_GENERATION = "async_llm_generation"


class RefinementModel(str, Enum):
    """How the user iterates on tool output."""
    EDIT_AND_RECOMPUTE = "edit_and_recompute"
    FEEDBACK_AND_REGENERATE = "feedback_and_regenerate"


@dataclass
class ModuleInput:
    """Definition of an input field for a tool."""
    name: str
    label: str
    description: str
    input_type: Literal["text", "textarea", "number", "select", "file", "checkbox"]
    required: bool = True
    options: list[str] | None = None  # For select inputs
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
class AlignmentSection:
    """A section within a tool alignment (e.g., a memo section or checklist category)."""
    id: str  # Unique identifier for the section
    title: str  # Display title
    description: str  # What this section covers
    key_points: list[str] = field(default_factory=list)  # Bullet points to include
    include: bool = True  # Whether to include this section
    order: int = 0  # Order in the output
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "key_points": self.key_points,
            "include": self.include,
            "order": self.order,
        }


@dataclass
class AlignmentParameter:
    """A configurable parameter for tool alignment (e.g., locale, metrics, assumptions)."""
    name: str  # Unique identifier
    label: str  # Display label
    description: str  # What this parameter controls
    param_type: Literal["text", "number", "select", "boolean"]
    value: Any  # Current value
    options: list[str] | None = None  # For select type
    unit: str | None = None  # Unit for numeric values (e.g., "USD", "%")
    
    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "description": self.description,
            "param_type": self.param_type,
            "value": self.value,
            "options": self.options,
            "unit": self.unit,
        }


@dataclass
class ModuleAlignment:
    """
    Alignment configuration for a tool before generation.
    
    This represents the "contract" between the assistant and user about
    what will be generated. The assistant proposes defaults, the user can
    modify them, and once confirmed, this guides generation.
    """
    module_id: str
    title: str  # Title of the alignment (e.g., "Investment Memo Outline")
    description: str  # Brief explanation of what user is confirming
    sections: list[AlignmentSection] = field(default_factory=list)
    parameters: list[AlignmentParameter] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)  # Key assumptions being made
    confirmed: bool = False  # Whether user has confirmed this alignment
    feedback: str | None = None  # User feedback if requesting changes
    
    def to_dict(self) -> dict:
        return {
            "module_id": self.module_id,
            "title": self.title,
            "description": self.description,
            "sections": [s.to_dict() for s in self.sections],
            "parameters": [p.to_dict() for p in self.parameters],
            "assumptions": self.assumptions,
            "confirmed": self.confirmed,
            "feedback": self.feedback,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "ModuleAlignment":
        """Create alignment from dictionary (e.g., from database)."""
        sections = [
            AlignmentSection(
                id=s["id"],
                title=s["title"],
                description=s["description"],
                key_points=s.get("key_points", []),
                include=s.get("include", True),
                order=s.get("order", 0),
            )
            for s in data.get("sections", [])
        ]
        parameters = [
            AlignmentParameter(
                name=p["name"],
                label=p["label"],
                description=p["description"],
                param_type=p["param_type"],
                value=p["value"],
                options=p.get("options"),
                unit=p.get("unit"),
            )
            for p in data.get("parameters", [])
        ]
        return cls(
            module_id=data.get("module_id") or data.get("tool_id", ""),
            title=data["title"],
            description=data["description"],
            sections=sections,
            parameters=parameters,
            assumptions=data.get("assumptions", []),
            confirmed=data.get("confirmed", False),
            feedback=data.get("feedback"),
        )


@dataclass
class ModuleOutput:
    """Result from running a tool."""
    module_id: str
    output_type: str  # "memo", "checklist", "spreadsheet", "chart", etc.
    title: str
    content: dict[str, Any]  # Structured content
    file_path: str | None = None  # If exported to file


@dataclass
class ModuleDefinition:
    """Metadata about a tool."""
    id: str
    name: str
    description: str
    icon: str  # Lucide icon name (e.g., "FileText", "CheckSquare")
    output_type: str
    category: str  # "analysis", "documentation", "technical", etc.
    keywords: list[str] = field(default_factory=list)  # For recommendation matching
    export_format: str | None = None  # "xlsx", "docx", or None if not directly exportable
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "icon": self.icon,
            "output_type": self.output_type,
            "category": self.category,
        }


@dataclass(kw_only=True)
class ModuleManifest(ModuleDefinition):
    """Full module contract metadata used for registry and exposure layers."""
    goal: str
    primary_ui_object: str
    workspace_build_widget: str | None = None
    workspace_output_widget: str | None = None
    export_artifact_types: list[str]
    adapter_bindings: dict[str, str]
    input_dependencies: list[str]
    produced_outputs: list[str]
    downstream_dependencies: list[str]
    assumptions_behavior: Literal["tracks", "none"]
    evidence_behavior: Literal["rag_grounded", "user_uploaded", "both", "none"]


class BaseModule(ABC):
    """Abstract base class for all Nitrogen tools."""
    
    @property
    @abstractmethod
    def definition(self) -> ModuleDefinition:
        """Return tool metadata."""
        pass

    @property
    @abstractmethod
    def manifest(self) -> ModuleManifest:
        """Return the full module manifest."""
        raise NotImplementedError
    
    @property
    @abstractmethod
    def required_inputs(self) -> list[ModuleInput]:
        """Return list of required input fields."""
        pass
    
    @property
    def optional_inputs(self) -> list[ModuleInput]:
        """Return list of optional input fields. Override in subclass."""
        return []
    
    @property
    def all_inputs(self) -> list[ModuleInput]:
        """Return all inputs (required + optional)."""
        return self.required_inputs + self.optional_inputs

    @property
    def workspace_setup_fields(self) -> list[dict[str, Any]]:
        """Optional setup-field definitions for workspace-backed modules.

        Launch modules all share the same setup/build/output lifecycle. Modules
        that participate in the workspace flow should expose any setup form
        fields here rather than relying on module_id branches in the workflow
        service.
        """
        return []
    
    @property
    def review_strategy(self) -> ReviewStrategy:
        """How this tool presents its plan for user review before executing."""
        return ReviewStrategy.NONE

    @property
    def execution_model(self) -> ExecutionModel:
        """Whether execution is deterministic computation or LLM generation."""
        return ExecutionModel.SYNC_COMPUTATION

    @property
    def refinement_model(self) -> RefinementModel:
        """How the user iterates on this tool's output."""
        return RefinementModel.EDIT_AND_RECOMPUTE

    @property
    def requires_alignment(self) -> bool:
        """Backward-compatible: derived from review_strategy."""
        return self.review_strategy == ReviewStrategy.OUTLINE_REVIEW
    
    def is_exportable(self, content: dict) -> bool:
        """Whether this deliverable content is in a state that can produce a downloadable file.

        Default: True when the tool declares an export_format.
        Override in subclasses with stricter requirements (e.g. model tools
        that need a completed computation).
        """
        return self.definition.export_format is not None

    def get_questions_for_chat(self) -> list[str]:
        """Generate conversational questions to gather inputs."""
        questions = []
        for inp in self.required_inputs:
            questions.append(inp.description)
        return questions
    
    def validate_inputs(self, inputs: dict[str, Any]) -> tuple[bool, list[str]]:
        """Validate that all required inputs are present."""
        missing = []
        for inp in self.required_inputs:
            if inp.name not in inputs or inputs[inp.name] is None:
                missing.append(inp.label)
        return len(missing) == 0, missing
    
    async def generate_alignment(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        inputs: dict[str, Any],
    ) -> ModuleAlignment | None:
        """
        Generate a proposed alignment configuration for this tool.
        
        This creates an intelligent default based on the project context,
        which the user can review and modify before generation.
        
        Override in subclass to provide tool-specific alignments.
        Returns None if tool doesn't require alignment.
        """
        return None
    
    async def update_alignment_from_feedback(
        self,
        current_alignment: ModuleAlignment,
        feedback: str,
        db: AsyncSession,
        initiative_id: UUID,
    ) -> ModuleAlignment:
        """
        Update alignment based on user feedback.
        
        Override in subclass for tool-specific feedback handling.
        Default implementation just stores the feedback.
        """
        current_alignment.feedback = feedback
        return current_alignment
    
    @abstractmethod
    async def execute(
        self, 
        db: AsyncSession,
        initiative_id: UUID,
        inputs: dict[str, Any],
        include_corpus: bool = True,
        alignment: ModuleAlignment | None = None,
    ) -> ModuleOutput:
        """Execute the tool and return output.
        
        If alignment is provided, use it to guide generation.
        """
        pass
    
    async def execute_from_conversation(
        self,
        conversation_text: str,
        planner_args: dict | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> tuple[str, dict]:
        """Execute tool using conversation text directly (no DB round-trip).

        This is the unified entry point for both project chat and research chat.
        Returns (widget_type, widget_data).

        Override in subclasses that support conversation-based execution.
        """
        raise NotImplementedError(
            f"{self.definition.name} does not support conversation-based execution"
        )

    async def build_workspace_widget_data(
        self,
        known_values: dict[str, Any],
    ) -> dict[str, Any]:
        """Build initial widget-backed workflow state for single-layer modules.

        Widget-backed modules should override this instead of depending on
        central module_id branching in the workflow service.
        """
        raise NotImplementedError(
            f"{self.definition.name} does not support widget-backed workspace build state"
        )

    async def export(
        self,
        output: ModuleOutput,
        format: str = "docx",
    ) -> str:
        """Export output to file. Override in subclass for custom export."""
        raise NotImplementedError(f"Export not implemented for {self.definition.name}")
