"""Tool registry for managing and recommending tools."""

import logging
import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.modules.base import BaseModule, ModuleDefinition

logger = logging.getLogger(__name__)


class ModuleRegistry:
    """Registry for all available tools with recommendation logic."""
    
    def __init__(self):
        self._modules: dict[str, "BaseModule"] = {}
        self._loaded = False

    def register(self, module: "BaseModule") -> None:
        """Register a module implementation with the platform registry."""
        self._modules[module.definition.id] = module
    
    def _load_modules(self):
        """Lazy load all tools."""
        if self._loaded:
            return
            
        from app.first_party.registry import register_modules

        register_modules(self)
        invalid_modules = self._collect_manifest_errors()
        if invalid_modules:
            if self._should_fail_fast_on_manifest_errors():
                details = "\n".join(
                    f"- {module_id}: {'; '.join(errors)}"
                    for module_id, errors in sorted(invalid_modules.items())
                )
                raise ValueError(f"Module manifest validation failed:\n{details}")

            for module_id, errors in sorted(invalid_modules.items()):
                logger.error(
                    "Disabling invalid module '%s' due to manifest wiring issues: %s",
                    module_id,
                    "; ".join(errors),
                )
                self._modules.pop(module_id, None)

            logger.warning(
                "Loaded %d modules after disabling %d invalid module(s).",
                len(self._modules),
                len(invalid_modules),
            )
        self._loaded = True

    def _collect_manifest_errors(self) -> dict[str, list[str]]:
        """Return module_id -> list of manifest validation errors."""
        from app.adapters import get_adapter_registry

        adapter_ids = {
            adapter.definition.adapter_id
            for adapter in get_adapter_registry().list_all()
        }
        module_ids = set(self._modules.keys())
        errors_by_module: dict[str, list[str]] = {}

        for module in self._modules.values():
            manifest = module.manifest
            for _role, adapter_id in manifest.adapter_bindings.items():
                if adapter_id not in adapter_ids:
                    errors_by_module.setdefault(module.definition.id, []).append(
                        f"unknown adapter '{adapter_id}'"
                    )
            for dependency in manifest.input_dependencies:
                if dependency not in module_ids:
                    errors_by_module.setdefault(module.definition.id, []).append(
                        f"unknown input dependency '{dependency}'"
                    )
            if manifest.export_artifact_types and module.definition.export_format is None:
                errors_by_module.setdefault(module.definition.id, []).append(
                    "declares export_artifact_types but has no definition.export_format"
                )
        return errors_by_module

    def _should_fail_fast_on_manifest_errors(self) -> bool:
        """Strict in dev/test; graceful degradation in production."""
        from app.config import get_settings

        override = os.getenv("NITROGEN_STRICT_MODULE_MANIFESTS")
        if override is not None:
            return override.strip().lower() in {"1", "true", "yes", "on"}

        if "PYTEST_CURRENT_TEST" in os.environ:
            return True

        return bool(get_settings().debug)
    
    def get_module(self, module_id: str) -> "BaseModule | None":
        """Get a tool by ID."""
        self._load_modules()
        return self._modules.get(module_id)
    
    def get_all_modules(self) -> list["BaseModule"]:
        """Get all registered tools."""
        self._load_modules()
        return list(self._modules.values())
    
    def get_all_definitions(self) -> list["ModuleDefinition"]:
        """Get definitions for all tools."""
        self._load_modules()
        return [m.definition for m in self._modules.values()]
    
    def recommend_modules(
        self, 
        project_description: str,
        project_type: str | None = None,
    ) -> list[tuple["BaseModule", float]]:
        """
        Recommend tools based on project description and type.
        Returns list of (tool, confidence_score) tuples for ALL tools, sorted by relevance.
        """
        self._load_modules()
        
        description_lower = project_description.lower() if project_description else ""
        
        from app.first_party.catalog import get_first_party_catalog

        keyword_scores = get_first_party_catalog().recommendation_keywords
        
        # Calculate scores for each tool
        module_scores: dict[str, float] = {}
        
        # Initialize all tools with base score
        for tool_id in self._modules.keys():
            module_scores[tool_id] = 0.2  # Base score for all tools
        
        # Boost scores based on keyword matches
        for keyword, tool_ids in keyword_scores.items():
            if keyword in description_lower:
                for tool_id in tool_ids:
                    if tool_id in module_scores:
                        module_scores[tool_id] += 1.0
        
        # Build recommendations for ALL tools
        recommendations = []
        max_score = max(module_scores.values()) if module_scores else 1
        
        for tool_id, score in module_scores.items():
            tool = self._modules.get(tool_id)
            if tool:
                # Normalize to 0-1
                confidence = min(score / max_score, 1.0)
                recommendations.append((tool, confidence))
        
        # Sort by confidence descending
        recommendations.sort(key=lambda x: x[1], reverse=True)
        
        return recommendations
    
    def classify_project_type(self, description: str) -> str:
        """Classify project type from description."""
        description_lower = description.lower()
        
        from app.first_party.catalog import get_first_party_catalog

        for project_type, keywords in get_first_party_catalog().project_type_keywords.items():
            if any(kw in description_lower for kw in keywords):
                return project_type
        
        # Default
        return "general"


# Singleton instance
_registry: ModuleRegistry | None = None


def get_module_registry() -> ModuleRegistry:
    """Get the singleton tool registry instance."""
    global _registry
    if _registry is None:
        _registry = ModuleRegistry()
    return _registry
