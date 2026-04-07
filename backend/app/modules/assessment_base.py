"""Base class for assessment-style modules with Setup / Build / Output workflow stages.

Assessment modules differ from calculator/document modules in that they are:
  - Multi-stage: Setup → Build (with sequential layers) → Output
  - Item-level: Build layers produce a list of items the user confirms/edits/removes
  - Progressive: later Build layers are unlocked after earlier ones have confirmed items
  - Traceable: every item carries provenance (derivation, sources, rationale)
"""

from __future__ import annotations

import json
import logging
import uuid as _uuid
from abc import abstractmethod
from dataclasses import dataclass, field
from typing import Any, Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.base import BaseModule, ModuleInput, ModuleOutput
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


# ---------------------------------------------------------------------------
# Assessment-specific definitions
# ---------------------------------------------------------------------------

ViewType = Literal["simple_list", "structured_list", "detail_node"]


@dataclass
class BuildLayerDef:
    """Definition of a single Build layer for an assessment module."""
    id: str
    name: str
    view_type: ViewType
    description: str = ""
    item_schema: dict = field(default_factory=dict)  # JSON-schema-like descriptor for item content
    removable: bool = True  # Whether users can delete individual items


@dataclass
class SetupFieldDef:
    """Definition of a single Setup form field."""
    name: str
    label: str
    description: str
    field_type: Literal["text", "textarea", "select"] = "text"
    required: bool = True
    options: list[str] | None = None
    placeholder: str | None = None


@dataclass
class AssessmentModuleDef:
    """Full definition of an assessment module (setup fields + build layers + output type)."""
    setup_fields: list[SetupFieldDef]
    build_layers: list[BuildLayerDef]
    output_type: str = "assessment_document"

    def to_dict(self) -> dict:
        return {
            "setup_fields": [
                {
                    "name": f.name,
                    "label": f.label,
                    "description": f.description,
                    "field_type": f.field_type,
                    "required": f.required,
                    "options": f.options,
                    "placeholder": f.placeholder,
                }
                for f in self.setup_fields
            ],
            "build_layers": [
                {
                    "id": layer.id,
                    "name": layer.name,
                    "view_type": layer.view_type,
                    "description": layer.description,
                    "item_schema": layer.item_schema,
                    "removable": layer.removable,
                }
                for layer in self.build_layers
            ],
            "output_type": self.output_type,
        }


# ---------------------------------------------------------------------------
# workflow_state helpers
# ---------------------------------------------------------------------------

def _make_empty_layer_state(layer_def: BuildLayerDef) -> dict:
    return {
        "status": "pending",
        "items": [],
    }


def make_initial_workflow_state(module_type: str, assessment_def: AssessmentModuleDef) -> dict:
    return {
        "module_type": module_type,
        "current_stage": "setup",
        "setup": {
            "fields": {},
            "confirmed": False,
            "confirmed_at": None,
        },
        "build": {
            "current_layer": assessment_def.build_layers[0].id if assessment_def.build_layers else None,
            "layers": {
                layer.id: _make_empty_layer_state(layer)
                for layer in assessment_def.build_layers
            },
        },
        "output": {
            "status": "pending",
            "content": None,
        },
    }


async def llm_json(
    system: str,
    user_msg: str,
    model: str = "gpt-4.1-mini",
) -> dict:
    """Call the platform OpenAI client and return parsed JSON. Returns {} on any error."""
    from app.core.llm_client import get_openai_client
    try:
        client, _is_byok = await get_openai_client(None, None)
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_msg},
            ],
            response_format={"type": "json_object"},
        )
        return json.loads(response.choices[0].message.content)
    except Exception as exc:
        logger.error("LLM JSON call failed: %s", exc)
        return {}


def make_build_item(content: dict, derivation: str = "inferred", sources: list[dict] | None = None, rationale: str = "") -> dict:
    """Create a standardised build item dict."""
    return {
        "id": str(_uuid.uuid4()),
        "content": content,
        "origin": derivation,
        "provenance": {
            "derivation": derivation,
            "sources": sources or [],
            "rationale": rationale,
        },
        "confirmed": False,
        "confirmed_at": None,
        "removable": True,
    }


# ---------------------------------------------------------------------------
# Base assessment module
# ---------------------------------------------------------------------------

class BaseAssessmentModule(BaseModule):
    """Abstract base for all assessment-style modules.

    Subclasses must implement:
      - definition (from BaseModule)
      - assessment_definition (returns AssessmentModuleDef)
      - generate_setup_defaults(db, initiative_id, context) -> dict
      - generate_layer(db, initiative_id, layer_id, setup_fields, prior_layers, context) -> list[dict]
      - generate_output(db, initiative_id, confirmed_build, setup_fields) -> dict
    """

    @property
    @abstractmethod
    def assessment_definition(self) -> AssessmentModuleDef:
        """Return the full assessment module configuration."""

    # BaseModule stubs (assessment modules don't use the old alignment flow)

    @property
    def required_inputs(self) -> list[ModuleInput]:
        return []

    async def execute(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        inputs: dict[str, Any],
        include_corpus: bool = True,
        alignment: Any = None,
    ) -> ModuleOutput:
        """Not used for assessment modules — workflow is driven via dedicated API endpoints."""
        raise NotImplementedError("Assessment modules use the workflow API, not execute()")

    # ------------------------------------------------------------------
    # Hooks subclasses must implement
    # ------------------------------------------------------------------

    @abstractmethod
    async def generate_setup_defaults(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        context: dict,
    ) -> dict:
        """Return AI-generated default values for the setup fields.

        Args:
            db: async database session
            initiative_id: the project being assessed
            context: dict with project info (title, description, geography, etc.)

        Returns:
            dict mapping field_name → default_value
        """

    @abstractmethod
    async def generate_layer(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        layer_id: str,
        setup_fields: dict,
        prior_layers: dict,
        context: dict,
    ) -> list[dict]:
        """Generate items for a specific build layer.

        Args:
            db: async database session
            initiative_id: the project
            layer_id: which layer to generate (e.g. "outline", "stakeholder_list")
            setup_fields: confirmed setup values
            prior_layers: dict of already-generated layers {layer_id: {status, items}}
            context: additional project context

        Returns:
            list of build item dicts (use make_build_item() helper)
        """

    @abstractmethod
    async def generate_output(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        setup_fields: dict,
        confirmed_build: dict,
    ) -> dict:
        """Generate the final assessment output document.

        Args:
            db: async database session
            initiative_id: the project
            setup_fields: confirmed setup values
            confirmed_build: confirmed build layers {layer_id: {items: [...]}}

        Returns:
            dict representing the structured output document
        """

    async def _retrieve_evidence(
        self,
        queries: list[str],
        db: AsyncSession,
        initiative_id: UUID,
        max_facts: int = 15,
    ) -> tuple[str, list[dict]]:
        """Run tiered retrieval (RAG + OpenAlex + web) for a list of queries.

        Returns (context_str_for_prompt, numbered_citations_list).
        Citations are deduplicated by source title.
        """
        from app.adapters import get_adapter_registry
        from app.core.execution_context import ExecutionContext

        retrieval_adapter = get_adapter_registry().get("retrieval")
        if retrieval_adapter is None:
            raise RuntimeError("retrieval adapter is not registered.")
        ctx = ExecutionContext(
            user_id="system",
            user_email=None,
            initiative_id=initiative_id,
            initiative_role=None,
            ai_access_granted=True,
            is_byok=False,
            request_id=f"assessment-retrieval:{initiative_id}",
        )
        all_facts: list = []
        seen_titles: set[str] = set()

        for query in queries:
            try:
                adapter_result = await retrieval_adapter.execute(
                    ctx,
                    db,
                    {
                        "query": query,
                        "initiative_id": str(initiative_id),
                        "include_openalex": True,
                        "include_web_search": True,
                        "include_llm_fallback": False,
                        "require_citation": False,
                    },
                )
                for fact in adapter_result.output.get("facts", []):
                    source_title = fact.get("source_title", "")
                    if source_title and source_title not in seen_titles:
                        seen_titles.add(source_title)
                        all_facts.append(fact)
            except Exception as exc:
                logger.warning(f"Retrieval failed for query '{query[:60]}': {exc}")

        # Cap and number
        all_facts = all_facts[:max_facts]
        citations: list[dict] = []
        context_lines: list[str] = []
        for i, fact in enumerate(all_facts, start=1):
            citations.append({
                "number": i,
                "source_type": fact.get("source_type", ""),
                "source_title": fact.get("source_title", ""),
                "source_url": fact.get("source_url", "") or "",
                "publisher": fact.get("publisher", "") or "",
                "excerpt": (fact.get("content", "") or "")[:300],
            })
            context_lines.append(
                f"[{i}] {fact.get('source_title', '')}"
                + (f" ({fact.get('publisher', '')})" if fact.get("publisher") else "")
                + f": {(fact.get('content', '') or '')[:400]}"
            )

        context_str = "\n".join(context_lines) if context_lines else ""
        return context_str, citations

    async def refine_item(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        layer_id: str,
        item: dict,
        feedback: str,
        setup_fields: dict,
        context: dict,
    ) -> dict:
        """Refine a single item via natural-language feedback.

        Default implementation does a simple LLM call to rewrite the item.
        Subclasses can override for more context-aware refinement.
        """
        from app.core.llm_client import get_openai_client, record_usage_from_response

        client = get_openai_client()
        layer_def = next(
            (layer for layer in self.assessment_definition.build_layers if layer.id == layer_id),
            None,
        )
        layer_name = layer_def.name if layer_def else layer_id

        prompt = (
            f"You are refining a single item in a {self.definition.name} assessment.\n"
            f"Layer: {layer_name}\n\n"
            f"Current item content:\n{json.dumps(item['content'], indent=2)}\n\n"
            f"User feedback: {feedback}\n\n"
            "Return the revised item content as a JSON object with the same structure. "
            "No commentary, just the JSON."
        )

        try:
            response = await client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
            )
            await record_usage_from_response(response, model="gpt-4.1-mini", initiative_id=str(initiative_id))
            revised_content = json.loads(response.choices[0].message.content)
            item = dict(item)
            item["content"] = revised_content
            item["origin"] = "user edited"
            item["provenance"] = dict(item.get("provenance", {}))
            item["provenance"]["derivation"] = "user_edited"
            return item
        except Exception as e:
            logger.error(f"Failed to refine item: {e}")
            return item
