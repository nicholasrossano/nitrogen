from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


ProjectStatusLevel = Literal["green", "yellow", "red", "unknown"]
ProjectStatusConfidence = Literal["high", "medium", "low", "unknown"]


class ProjectStatusOverrideEntry(BaseModel):
    id: str
    category_key: str
    prior_system_status: ProjectStatusLevel | None = None
    override_status: ProjectStatusLevel
    explanation: str | None = None
    overridden_by_email: str | None = None
    created_at: datetime


class ProjectStatusCriterion(BaseModel):
    id: str
    text: str
    type: Literal["qualitative", "indicator", "metric"] = "qualitative"
    metric_hint: str | None = None


class ProjectStatusCriteria(BaseModel):
    summary: str = ""
    criteria: list[ProjectStatusCriterion] = Field(default_factory=list)
    retrieval_focus: list[str] = Field(default_factory=list)
    parse_warnings: list[str] = Field(default_factory=list)


class ProjectStatusCategoryConfig(BaseModel):
    id: str
    category_key: str
    label: str
    definition_text: str
    criteria: ProjectStatusCriteria | None = None
    is_active: bool = True
    created_at: datetime
    updated_at: datetime


class ProjectStatusCategoryCreateRequest(BaseModel):
    label: str = Field(min_length=1, max_length=255)
    definition_text: str = Field(default="", max_length=8000)
    category_key: str | None = Field(default=None, max_length=120)


class ProjectStatusCategoryUpdateRequest(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=255)
    definition_text: str | None = Field(default=None, max_length=8000)
    criteria: ProjectStatusCriteria | None = None
    is_active: bool | None = None


class ProjectStatusCategoryRow(BaseModel):
    category_key: str
    label: str
    definition_text: str
    criteria_summary: str | None = None
    status: ProjectStatusLevel
    effective_status: ProjectStatusLevel
    confidence: ProjectStatusConfidence
    rationale: str
    critical_insight: str
    supporting_evidence: list[str] = Field(default_factory=list)
    suggested_improvement: str | None = None
    retrieved_sources: list[dict[str, Any]] = Field(default_factory=list)
    positive_drivers: list[str] = Field(default_factory=list)
    negative_drivers: list[str] = Field(default_factory=list)
    blockers: list[str] = Field(default_factory=list)
    missing_items: list[str] = Field(default_factory=list)
    relevant_modules: list[str] = Field(default_factory=list)
    relevant_module_names: list[str] = Field(default_factory=list)
    relevant_assessments: list[dict[str, Any]] = Field(default_factory=list)
    improvement_actions: list[str] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)
    update_source: str
    last_updated_at: datetime
    is_stale: bool
    has_override: bool
    overrides: list[ProjectStatusOverrideEntry] = Field(default_factory=list)


class ProjectStatusResponse(BaseModel):
    domain: str
    project_id: str
    stale: bool
    categories: list[ProjectStatusCategoryRow]


class ProjectStatusRefreshRequest(BaseModel):
    source: str = Field(default="manual_refresh")


class ProjectStatusOverrideRequest(BaseModel):
    status: ProjectStatusLevel
    explanation: str | None = None


class ProjectStatusCriteriaGenerateRequest(BaseModel):
    persist: bool = Field(default=True, description="When false, return preview without saving.")
