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
    
    def _load_modules(self):
        """Lazy load all tools."""
        if self._loaded:
            return
            
        # Import modules here to avoid circular imports
        from app.modules.investment_memo import InvestmentMemoTool
        from app.modules.due_diligence_checklist import DueDiligenceChecklistTool
        from app.modules.lcoe_module import LCOETool
        from app.modules.carbon_module import CarbonTool
        from app.modules.pvwatts_module import PVWattsTool
        from app.modules.stakeholder_assessment import StakeholderAssessmentModule
        from app.modules.landscape_mapping import LandscapeMappingModule
        from app.modules.esmp import ESMPModule
        from app.modules.mel_plan import MELPlanModule

        tools = [
            InvestmentMemoTool(),
            DueDiligenceChecklistTool(),
            LCOETool(),
            CarbonTool(),
            PVWattsTool(),
            StakeholderAssessmentModule(),
            LandscapeMappingModule(),
            ESMPModule(),
            MELPlanModule(),
        ]
        
        for tool in tools:
            self._modules[tool.definition.id] = tool
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
        
        # Keyword matching for boosting scores
        keyword_scores = {
            # Energy/power related
            "solar": ["investment_memo", "due_diligence_checklist"],
            "pv": ["investment_memo", "due_diligence_checklist"],
            "mini-grid": ["investment_memo", "due_diligence_checklist"],
            "minigrid": ["investment_memo", "due_diligence_checklist"],
            "micro-grid": ["investment_memo", "due_diligence_checklist"],
            "microgrid": ["investment_memo", "due_diligence_checklist"],
            "battery": ["investment_memo", "due_diligence_checklist"],
            "storage": ["investment_memo", "due_diligence_checklist"],
            "renewable": ["investment_memo", "due_diligence_checklist"],
            "wind": ["investment_memo", "due_diligence_checklist"],
            "hydro": ["investment_memo", "due_diligence_checklist"],
            
            # Clean cooking
            "cookstove": ["investment_memo", "due_diligence_checklist"],
            "cooking": ["investment_memo", "due_diligence_checklist"],
            "lpg": ["investment_memo", "due_diligence_checklist"],
            "biogas": ["investment_memo", "due_diligence_checklist"],
            "ethanol": ["investment_memo", "due_diligence_checklist"],
            "fuel": ["investment_memo", "due_diligence_checklist"],
            
            # General development
            "investment": ["investment_memo"],
            "funding": ["investment_memo"],
            "grant": ["investment_memo"],
            "project": ["investment_memo", "due_diligence_checklist"],
            "initiative": ["investment_memo", "due_diligence_checklist"],
            "pilot": ["investment_memo", "due_diligence_checklist"],
            "scale": ["investment_memo", "due_diligence_checklist"],
            
            # Due diligence specific
            "risk": ["due_diligence_checklist"],
            "assess": ["due_diligence_checklist"],
            "evaluate": ["due_diligence_checklist"],
            "review": ["due_diligence_checklist"],
            "audit": ["due_diligence_checklist"],
            "compliance": ["due_diligence_checklist"],

            # ESMP
            "esmp": ["esmp"],
            "environmental": ["esmp"],
            "safeguards": ["esmp"],
            "e&s": ["esmp"],
            "ifc": ["esmp"],
            "social impact": ["esmp"],
            "mitigation": ["esmp"],
            "resettlement": ["esmp"],
            "biodiversity": ["esmp"],
            "esia": ["esmp"],

            # MEL Plan
            "mel": ["mel_plan"],
            "monitoring": ["mel_plan"],
            "evaluation": ["mel_plan"],
            "results framework": ["mel_plan"],
            "logframe": ["mel_plan"],
            "indicators": ["mel_plan"],
            "impact measurement": ["mel_plan"],
            "theory of change": ["mel_plan"],
            "iris": ["mel_plan"],
            "reporting": ["mel_plan"],
            
            # LCOE / economics
            "lcoe": ["lcoe_model"],
            "levelized": ["lcoe_model"],
            "cost of energy": ["lcoe_model"],
            "cost per kwh": ["lcoe_model"],
            "economics": ["lcoe_model"],
            "feasibility": ["lcoe_model"],
            "capex": ["lcoe_model"],
            "opex": ["lcoe_model"],
            "wacc": ["lcoe_model"],
            "discount rate": ["lcoe_model"],
            "capacity factor": ["lcoe_model"],
            "tariff": ["lcoe_model"],
            
            # Carbon / emissions
            "carbon": ["carbon_model"],
            "emissions": ["carbon_model"],
            "tco2": ["carbon_model"],
            "tco2e": ["carbon_model"],
            "emission reductions": ["carbon_model"],
            "carbon credits": ["carbon_model"],
            "fnrb": ["carbon_model"],
            "baseline emissions": ["carbon_model"],
            "er calculation": ["carbon_model"],
            "leakage": ["carbon_model"],
            "gold standard": ["carbon_model"],
            "emission factor": ["carbon_model"],
        }
        
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
        
        # Investment memo gets a slight default boost (most common need)
        module_scores["investment_memo"] = module_scores.get("investment_memo", 0) + 0.3
        
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
        
        # Energy access
        if any(kw in description_lower for kw in ["mini-grid", "minigrid", "micro-grid", "microgrid", "solar", "pv", "battery"]):
            return "energy_access"
        
        # Clean cooking
        if any(kw in description_lower for kw in ["cookstove", "cooking", "lpg", "biogas", "ethanol", "fuel", "charcoal"]):
            return "clean_cooking"
        
        # Agriculture
        if any(kw in description_lower for kw in ["farm", "agriculture", "crop", "irrigation", "livestock"]):
            return "agriculture"
        
        # Water/WASH
        if any(kw in description_lower for kw in ["water", "sanitation", "wash", "well", "pump"]):
            return "water_sanitation"
        
        # Health
        if any(kw in description_lower for kw in ["health", "clinic", "hospital", "medical"]):
            return "health"
        
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
