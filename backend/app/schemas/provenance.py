"""Unified provenance schemas used across all AI-generated content.

Two-layer architecture:
  Layer 1 – ProvenanceTrace: internal audit log per generation event
  Layer 2 – ItemProvenance + SourceAttribution: per-item user-facing citation
"""

from __future__ import annotations

from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Derivation: how the AI arrived at this value (immutable once set)
# ---------------------------------------------------------------------------

class Derivation(str, Enum):
    PROVIDED = "provided"
    RESEARCHED = "researched"
    INFERRED = "inferred"
    ASSUMED = "assumed"


# ---------------------------------------------------------------------------
# ValidationStatus: mutable user review state (independent of derivation)
# ---------------------------------------------------------------------------

class ValidationStatus(str, Enum):
    CONFIRMED = "confirmed"
    UNCONFIRMED = "unconfirmed"
    MISSING = "missing"


# ---------------------------------------------------------------------------
# Layer 2 – Source Attribution (per-item, user-facing)
# ---------------------------------------------------------------------------

class SourceAttribution(BaseModel):
    """A single source backing an AI-generated item."""

    source_type: str = Field(
        ...,
        description="corpus, evidence, web, openalex, conversation, llm_estimate",
    )
    source_title: str
    source_url: Optional[str] = None
    chunk_id: Optional[str] = None
    excerpt: Optional[str] = Field(
        None, description="Specific passage from the source supporting this item"
    )
    confidence: float = Field(1.0, ge=0.0, le=1.0)
    publisher: Optional[str] = None


class ItemProvenance(BaseModel):
    """Provenance metadata attached to a single AI-generated output item.

    Examples of "items": a project-plan line item, an LCOE input value,
    a proposed-value widget, or a deep-dive element.
    """

    derivation: Derivation
    sources: list[SourceAttribution] = Field(default_factory=list)
    rationale: str = Field(
        "", description="1-2 sentence explanation connecting sources to the conclusion"
    )
    trace_id: Optional[UUID] = Field(
        None, description="FK to provenance_traces for Layer-1 drill-down"
    )


# ---------------------------------------------------------------------------
# Layer 1 – Provenance Trace (per generation event, internal/audit)
# ---------------------------------------------------------------------------

class ProvenanceTraceCreate(BaseModel):
    """Schema for writing a new provenance trace row."""

    project_id: Optional[UUID] = None
    chat_id: Optional[UUID] = Field(
        None, description="Core-chat ID when not tied to an initiative"
    )
    trigger: str = Field(
        ...,
        description="What caused this generation: chat_message, plan_generation, lcoe_run, etc.",
    )
    trigger_ref: Optional[str] = Field(
        None, description="ID of the message / widget / plan that triggered the event"
    )
    retrieval_context: list[dict] = Field(
        default_factory=list,
        description="Full list of RetrievedFacts (not just cited ones)",
    )
    thinking_lines: list[str] = Field(default_factory=list)
    model_id: str = Field("", description="e.g. gpt-4o-2024-08-06")
    prompt_template: str = Field("", description="Template name or hash")
    latency_ms: Optional[int] = None
    token_usage: dict = Field(
        default_factory=dict,
        description="{prompt_tokens, completion_tokens}",
    )


class ProvenanceTraceResponse(BaseModel):
    """Read-only representation of a stored trace."""

    id: UUID
    project_id: Optional[UUID] = None
    chat_id: Optional[UUID] = None
    trigger: str
    trigger_ref: Optional[str] = None
    retrieval_context: list[dict] = []
    thinking_lines: list[str] = []
    model_id: str = ""
    prompt_template: str = ""
    latency_ms: Optional[int] = None
    token_usage: dict = {}

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Helpers to build provenance objects from existing dataclasses
# ---------------------------------------------------------------------------

def source_attribution_from_retrieved_fact(fact) -> SourceAttribution:
    """Convert a tiered_retrieval.RetrievedFact to a SourceAttribution."""
    return SourceAttribution(
        source_type=fact.source_type.value if hasattr(fact.source_type, "value") else str(fact.source_type),
        source_title=fact.source_title,
        source_url=getattr(fact, "source_url", None),
        chunk_id=getattr(fact, "chunk_id", None),
        confidence=getattr(fact, "confidence", 1.0),
        publisher=getattr(fact, "publisher", None),
    )
