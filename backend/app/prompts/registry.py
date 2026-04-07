"""Prompt registry — single place to enumerate all system prompts used by Nitrogen services."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal


@dataclass
class PromptDefinition:
    """Metadata wrapper around a single system-prompt template."""

    id: str
    name: str
    description: str
    template: str
    parameters: list[str] = field(default_factory=list)
    owning_service: str = ""
    visibility: Literal["internal", "debug", "exposed"] = "internal"
    version: str = "1"


class PromptRegistry:
    """Registry for all system prompts used across Nitrogen services."""

    def __init__(self) -> None:
        self._prompts: dict[str, PromptDefinition] = {}
        self._loaded = False

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _load_prompts(self) -> None:
        """Lazily import prompt constants from service modules and register them.

        Imports are deferred to avoid circular-import issues at module load time,
        mirroring the pattern used by ModuleRegistry._load_modules().
        """
        if self._loaded:
            return

        # --- orchestration ---
        from app.services.orchestration import ORCHESTRATION_SYSTEM_PROMPT

        self._register(PromptDefinition(
            id="orchestration_system",
            name="Orchestration System Prompt",
            description=(
                "Drives the main chat orchestration loop: phase detection (Describe / Clarify / "
                "Generate Plan), tool-call decision rules, and response style guidelines."
            ),
            template=ORCHESTRATION_SYSTEM_PROMPT,
            parameters=[
                "title",
                "project_type",
                "description",
                "geography",
                "has_documents",
                "has_plan",
                "documents_requested",
                "clarifying_asked",
                "user_message_count",
                "model_inputs_context",
                "retrieved_context",
            ],
            owning_service="orchestration",
            visibility="internal",
        ))

        # --- chat: planning ---
        from app.services.chat import PLANNING_SYSTEM_PROMPT

        self._register(PromptDefinition(
            id="planning_system",
            name="Planning System Prompt",
            description=(
                "Research-planning assistant prompt used when the orchestrator calls a planning "
                "tool-call step. Accepts the current model-inputs state as a slot."
            ),
            template=PLANNING_SYSTEM_PROMPT,
            parameters=["model_inputs_context"],
            owning_service="chat",
            visibility="internal",
        ))

        # --- chat: answerer ---
        # SYSTEM_PROMPT in chat.py is concatenated with context strings, not .format()'d directly.
        from app.services.chat import SYSTEM_PROMPT as ANSWERER_SYSTEM_PROMPT

        self._register(PromptDefinition(
            id="answerer_system",
            name="Answerer System Prompt",
            description=(
                "Expert environmental-advisor persona used for evidence-grounded Q&A answers. "
                "No format slots — dynamic context is prepended/appended by the caller."
            ),
            template=ANSWERER_SYSTEM_PROMPT,
            parameters=[],
            owning_service="chat",
            visibility="internal",
        ))

        # --- chat: compare ---
        from app.services.chat import COMPARE_SYSTEM_PROMPT

        self._register(PromptDefinition(
            id="compare_system",
            name="Compare System Prompt",
            description=(
                "Side-by-side comparative analyst prompt for evaluating two projects. "
                "Slots are filled with the two initiative titles."
            ),
            template=COMPARE_SYSTEM_PROMPT,
            parameters=["title_a", "title_b"],
            owning_service="chat",
            visibility="internal",
        ))

        # --- project_plan: main ---
        # SYSTEM_PROMPT in project_plan.py; imported with alias to avoid name collision.
        from app.services.project_plan import SYSTEM_PROMPT as PROJECT_PLAN_SYSTEM_PROMPT

        self._register(PromptDefinition(
            id="project_plan_system",
            name="Project Plan System Prompt",
            description=(
                "Expert sustainable-development program designer prompt used for structured "
                "project-plan generation. Dynamic category/web-citation addenda are appended "
                "by the service at call time; no format slots in the base constant."
            ),
            template=PROJECT_PLAN_SYSTEM_PROMPT,
            parameters=[],
            owning_service="project_plan",
            visibility="internal",
        ))

        # --- project_plan: category proposal ---
        from app.services.project_plan import CATEGORY_PROPOSAL_SYSTEM_PROMPT

        self._register(PromptDefinition(
            id="category_proposal_system",
            name="Category Proposal System Prompt",
            description=(
                "Prompt used for proposing project-plan categories before the main plan is "
                "generated. Dynamic project context is supplied in the user message, not via "
                "format slots."
            ),
            template=CATEGORY_PROPOSAL_SYSTEM_PROMPT,
            parameters=[],
            owning_service="project_plan",
            visibility="internal",
        ))

        # --- deep_dive: query generation ---
        from app.services.deep_dive import QUERY_GEN_SYSTEM_PROMPT

        self._register(PromptDefinition(
            id="query_gen_system",
            name="Query Generation System Prompt",
            description=(
                "Search-query specialist prompt that generates targeted web/regulatory search "
                "queries from a pillar requirement. Dynamic context is supplied in the user "
                "message."
            ),
            template=QUERY_GEN_SYSTEM_PROMPT,
            parameters=[],
            owning_service="deep_dive",
            visibility="internal",
        ))

        # --- deep_dive: deep dive analysis ---
        from app.services.deep_dive import DEEP_DIVE_SYSTEM_PROMPT

        self._register(PromptDefinition(
            id="deep_dive_system",
            name="Deep Dive System Prompt",
            description=(
                "Regulatory and compliance analyst prompt for extracting grounded evidence "
                "elements. Dynamic uploaded-docs and evidence blocks are embedded in the user "
                "message."
            ),
            template=DEEP_DIVE_SYSTEM_PROMPT,
            parameters=[],
            owning_service="deep_dive",
            visibility="internal",
        ))

        # --- memo generation (file-loaded) ---
        _memo_path = Path(__file__).parent / "memo_generation.txt"
        _memo_template = _memo_path.read_text(encoding="utf-8") if _memo_path.exists() else ""

        self._register(PromptDefinition(
            id="memo_generation",
            name="Memo Generation System Prompt",
            description=(
                "System prompt for the investment-memo generation step, loaded from "
                "prompts/memo_generation.txt. Dynamic initiative summary and context are "
                "injected via the user message, not format slots."
            ),
            template=_memo_template,
            parameters=[],
            owning_service="memo_generator",
            visibility="internal",
        ))

        # --- intake system (file-loaded, deprecated) ---
        _intake_path = Path(__file__).parent / "intake_system.txt"
        _intake_template = _intake_path.read_text(encoding="utf-8") if _intake_path.exists() else ""

        self._register(PromptDefinition(
            id="intake_system",
            name="Intake System Prompt (deprecated)",
            description=(
                "DEPRECATED — file exists on disk (prompts/intake_system.txt) but is not "
                "imported or used anywhere in the Python backend. Registered here for "
                "discoverability only."
            ),
            template=_intake_template,
            parameters=[],
            owning_service="",
            visibility="debug",
        ))

        self._loaded = True

    def _register(self, definition: PromptDefinition) -> None:
        """Internal: add a definition without triggering lazy-load."""
        self._prompts[definition.id] = definition

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def register(self, definition: PromptDefinition) -> None:
        """Register a prompt definition (triggers lazy load first)."""
        self._load_prompts()
        self._prompts[definition.id] = definition

    def get(self, prompt_id: str) -> PromptDefinition | None:
        """Return the definition for *prompt_id*, or None if not found."""
        self._load_prompts()
        return self._prompts.get(prompt_id)

    def list_all(self) -> list[PromptDefinition]:
        """Return all registered prompt definitions, sorted by id."""
        self._load_prompts()
        return sorted(self._prompts.values(), key=lambda d: d.id)


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_registry: PromptRegistry | None = None


def get_prompt_registry() -> PromptRegistry:
    """Return the singleton PromptRegistry instance."""
    global _registry
    if _registry is None:
        _registry = PromptRegistry()
    return _registry
