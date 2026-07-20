"""Tool registry for managing and recommending tools."""

import logging
import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.assessments.base import BaseAssessment, AssessmentDefinition

logger = logging.getLogger(__name__)


class AssessmentRegistry:
    """Registry for all available tools with recommendation logic."""
    
    def __init__(self):
        self._assessments: dict[str, "BaseAssessment"] = {}
        self._loaded = False

    def register(self, assessment: "BaseAssessment") -> None:
        """Register a assessment implementation with the platform registry."""
        self._assessments[assessment.definition.id] = assessment
    
    def _load_assessments(self):
        """Lazy load all tools."""
        if self._loaded:
            return
            
        from app.domain.registry import register_assessments

        register_assessments(self)
        invalid_assessments = self._collect_manifest_errors()
        if invalid_assessments:
            if self._should_fail_fast_on_manifest_errors():
                details = "\n".join(
                    f"- {assessment_id}: {'; '.join(errors)}"
                    for assessment_id, errors in sorted(invalid_assessments.items())
                )
                raise ValueError(f"Assessment manifest validation failed:\n{details}")

            for assessment_id, errors in sorted(invalid_assessments.items()):
                logger.error(
                    "Disabling invalid assessment '%s' due to manifest wiring issues: %s",
                    assessment_id,
                    "; ".join(errors),
                )
                self._assessments.pop(assessment_id, None)

            logger.warning(
                "Loaded %d assessments after disabling %d invalid assessment(s).",
                len(self._assessments),
                len(invalid_assessments),
            )
        self._loaded = True

    def _collect_manifest_errors(self) -> dict[str, list[str]]:
        """Return assessment_id -> list of manifest validation errors."""
        from app.adapters import get_adapter_registry

        adapter_ids = {
            adapter.definition.adapter_id
            for adapter in get_adapter_registry().list_all()
        }
        assessment_ids = set(self._assessments.keys())
        errors_by_assessment: dict[str, list[str]] = {}

        for assessment in self._assessments.values():
            manifest = assessment.manifest
            for _role, adapter_id in manifest.adapter_bindings.items():
                if adapter_id not in adapter_ids:
                    errors_by_assessment.setdefault(assessment.definition.id, []).append(
                        f"unknown adapter '{adapter_id}'"
                    )
            for dependency in manifest.input_dependencies:
                if dependency not in assessment_ids:
                    errors_by_assessment.setdefault(assessment.definition.id, []).append(
                        f"unknown input dependency '{dependency}'"
                    )
            if manifest.export_artifact_types and assessment.definition.export_format is None:
                errors_by_assessment.setdefault(assessment.definition.id, []).append(
                    "declares export_artifact_types but has no definition.export_format"
                )
        return errors_by_assessment

    def _should_fail_fast_on_manifest_errors(self) -> bool:
        """Strict in dev/test; graceful degradation in production."""
        from app.config import get_settings

        override = os.getenv("NITROGEN_STRICT_MODULE_MANIFESTS")
        if override is not None:
            return override.strip().lower() in {"1", "true", "yes", "on"}

        if "PYTEST_CURRENT_TEST" in os.environ:
            return True

        return bool(get_settings().debug)
    
    def get_assessment(self, assessment_id: str) -> "BaseAssessment | None":
        """Get a tool by ID."""
        self._load_assessments()
        return self._assessments.get(assessment_id)
    
    def get_all_assessments(self) -> list["BaseAssessment"]:
        """Get all registered tools."""
        self._load_assessments()
        return list(self._assessments.values())
    
    def get_all_definitions(self) -> list["AssessmentDefinition"]:
        """Get definitions for all tools."""
        self._load_assessments()
        return [m.definition for m in self._assessments.values()]
    
    def recommend_assessments(
        self,
        project_description: str,
        project_type: str | None = None,
    ) -> list[tuple["BaseAssessment", float]]:
        """
        Score tools for a project description/type.

        Returns (tool, confidence) for ALL tools, sorted by relevance. Confidence
        reflects absolute evidence (not max-normalized), so a no-signal project
        does not collapse every tool to 1.0.
        """
        self._load_assessments()

        from app.assessments.recommendation import (
            build_recommendation_rows,
            score_assessments,
            select_recommended_ids,
        )

        scores = score_assessments(
            project_description=project_description or "",
            project_type=project_type,
            assessment_ids=set(self._assessments.keys()),
        )
        recommended_ids = select_recommended_ids(scores)
        rows = build_recommendation_rows(
            assessments=list(self._assessments.values()),
            scores=scores,
            recommended_ids=recommended_ids,
        )
        return [(tool, confidence) for tool, confidence, _recommended in rows]

    def recommend_assessments_with_flags(
        self,
        project_description: str,
        project_type: str | None = None,
    ) -> list[tuple["BaseAssessment", float, bool]]:
        """Like recommend_assessments, but also returns the recommended flag."""
        self._load_assessments()

        from app.assessments.recommendation import (
            build_recommendation_rows,
            score_assessments,
            select_recommended_ids,
        )

        scores = score_assessments(
            project_description=project_description or "",
            project_type=project_type,
            assessment_ids=set(self._assessments.keys()),
        )
        recommended_ids = select_recommended_ids(scores)
        return build_recommendation_rows(
            assessments=list(self._assessments.values()),
            scores=scores,
            recommended_ids=recommended_ids,
        )
    
    def classify_project_type(self, description: str) -> str:
        """Classify project type from description."""
        description_lower = description.lower()
        
        from app.domain.registry import get_first_party_catalog

        for project_type, keywords in get_first_party_catalog().project_type_keywords.items():
            if any(kw in description_lower for kw in keywords):
                return project_type
        
        # Default
        return "general"


# Singleton instance
_registry: AssessmentRegistry | None = None


def get_assessment_registry() -> AssessmentRegistry:
    """Get the singleton tool registry instance."""
    global _registry
    if _registry is None:
        _registry = AssessmentRegistry()
    return _registry
