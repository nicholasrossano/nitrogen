"""Tool registry for managing and recommending tools."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.tools.base import BaseTool, ToolDefinition


class ToolRegistry:
    """Registry for all available tools with recommendation logic."""
    
    def __init__(self):
        self._tools: dict[str, "BaseTool"] = {}
        self._loaded = False
    
    def _load_tools(self):
        """Lazy load all tools."""
        if self._loaded:
            return
            
        # Import tools here to avoid circular imports
        from app.tools.investment_memo import InvestmentMemoTool
        from app.tools.due_diligence_checklist import DueDiligenceChecklistTool
        from app.tools.lcoe_tool import LCOETool
        from app.tools.carbon_tool import CarbonTool
        from app.tools.template_tool import TemplateFillTool
        from app.tools.pvwatts_tool import PVWattsTool
        
        tools = [
            InvestmentMemoTool(),
            DueDiligenceChecklistTool(),
            LCOETool(),
            CarbonTool(),
            TemplateFillTool(),
            PVWattsTool(),
        ]
        
        for tool in tools:
            self._tools[tool.definition.id] = tool
        
        self._loaded = True
    
    def get_tool(self, tool_id: str) -> "BaseTool | None":
        """Get a tool by ID."""
        self._load_tools()
        return self._tools.get(tool_id)
    
    def get_all_tools(self) -> list["BaseTool"]:
        """Get all registered tools."""
        self._load_tools()
        return list(self._tools.values())
    
    def get_all_definitions(self) -> list["ToolDefinition"]:
        """Get definitions for all tools."""
        self._load_tools()
        return [tool.definition for tool in self._tools.values()]
    
    def recommend_tools(
        self, 
        project_description: str,
        project_type: str | None = None,
    ) -> list[tuple["BaseTool", float]]:
        """
        Recommend tools based on project description and type.
        Returns list of (tool, confidence_score) tuples for ALL tools, sorted by relevance.
        """
        self._load_tools()
        
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
        tool_scores: dict[str, float] = {}
        
        # Initialize all tools with base score
        for tool_id in self._tools.keys():
            tool_scores[tool_id] = 0.2  # Base score for all tools
        
        # Boost scores based on keyword matches
        for keyword, tool_ids in keyword_scores.items():
            if keyword in description_lower:
                for tool_id in tool_ids:
                    if tool_id in tool_scores:
                        tool_scores[tool_id] += 1.0
        
        # Investment memo gets a slight default boost (most common need)
        tool_scores["investment_memo"] = tool_scores.get("investment_memo", 0) + 0.3
        
        # Build recommendations for ALL tools
        recommendations = []
        max_score = max(tool_scores.values()) if tool_scores else 1
        
        for tool_id, score in tool_scores.items():
            tool = self._tools.get(tool_id)
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
_registry: ToolRegistry | None = None


def get_tool_registry() -> ToolRegistry:
    """Get the singleton tool registry instance."""
    global _registry
    if _registry is None:
        _registry = ToolRegistry()
    return _registry
