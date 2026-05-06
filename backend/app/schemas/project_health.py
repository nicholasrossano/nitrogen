from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


ProjectHealthStatus = Literal["green", "yellow", "red", "unknown"]
ProjectHealthConfidence = Literal["high", "medium", "low", "unknown"]


class ProjectHealthOverrideEntry(BaseModel):
    id: str = Field(description="Override event id.")
    dimension_id: str = Field(description="Dimension identifier.")
    prior_system_status: ProjectHealthStatus | None = Field(
        default=None,
        description="Previous system-generated status before this override.",
    )
    override_status: ProjectHealthStatus = Field(description="User-selected override status.")
    explanation: str | None = Field(default=None, description="User-provided context for the override.")
    overridden_by_email: str | None = Field(default=None, description="Readable actor identity when available.")
    created_at: datetime = Field(description="Timestamp when the override was created.")


class ProjectHealthDimensionResponse(BaseModel):
    dimension_id: str = Field(description="Stable dimension identifier.")
    label: str = Field(description="Dimension label for display.")
    description: str = Field(description="Dimension description.")
    status: ProjectHealthStatus = Field(description="Latest system-generated status.")
    effective_status: ProjectHealthStatus = Field(description="Status shown to users after applying overrides.")
    confidence: ProjectHealthConfidence = Field(description="Confidence in the system-generated status.")
    rationale: str = Field(description="Short explainable rationale.")
    critical_insight: str = Field(description="Concise decision-relevant judgment for this dimension.")
    supporting_evidence: list[str] = Field(
        default_factory=list,
        description="Strongest evidence or module outputs supporting the assessment.",
    )
    suggested_improvement: str | None = Field(default=None, description="Best next improvement action.")
    retrieved_sources: list[dict] = Field(
        default_factory=list,
        description="Retrieved project-brain source excerpts used for the assessment.",
    )
    positive_drivers: list[str] = Field(default_factory=list, description="Main supporting signals.")
    negative_drivers: list[str] = Field(default_factory=list, description="Main weakening signals.")
    blockers: list[str] = Field(default_factory=list, description="Active blockers or red triggers.")
    missing_items: list[str] = Field(default_factory=list, description="Missing evidence or assumptions.")
    relevant_modules: list[str] = Field(default_factory=list, description="Assessments considered for this dimension.")
    relevant_module_names: list[str] = Field(
        default_factory=list,
        description="Human-readable module instance names considered for this dimension.",
    )
    relevant_assessments: list[dict] = Field(
        default_factory=list,
        description="Assessment instance references (id, assessment_id, display_name) cited for this dimension.",
    )
    improvement_actions: list[str] = Field(default_factory=list, description="Suggested next actions.")
    uncertainties: list[str] = Field(default_factory=list, description="Important caveats or unknowns.")
    update_source: str = Field(description="Source that produced the latest system-generated row.")
    last_updated_at: datetime = Field(description="Timestamp for the latest system-generated refresh.")
    is_stale: bool = Field(description="Whether the persisted result is stale versus current project state.")
    has_override: bool = Field(description="Whether a user override currently changes displayed status.")
    overrides: list[ProjectHealthOverrideEntry] = Field(
        default_factory=list,
        description="Override history for this dimension ordered newest first.",
    )


class ProjectHealthResponse(BaseModel):
    domain: str = Field(description="Active domain key used for health dimensions.")
    initiative_id: str = Field(description="Project identifier.")
    stale: bool = Field(description="Whether any returned dimension result is stale.")
    dimensions: list[ProjectHealthDimensionResponse] = Field(description="Health rows for configured dimensions.")


class ProjectHealthRefreshRequest(BaseModel):
    source: str = Field(
        default="manual_refresh",
        description="Refresh trigger source label such as manual_refresh or module_completion.",
    )


class ProjectHealthOverrideRequest(BaseModel):
    status: ProjectHealthStatus = Field(description="Override status to apply.")
    explanation: str | None = Field(default=None, description="Optional explanation for the override.")
