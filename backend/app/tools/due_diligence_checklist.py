"""Due Diligence Checklist tool - generates structured assessment checklists."""

from datetime import date
from typing import Any
from uuid import UUID
import json

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.tools.base import BaseTool, ToolDefinition, ToolInput, ToolOutput
from app.services.rag import RAGService

settings = get_settings()


class DueDiligenceChecklistTool(BaseTool):
    """Tool for generating due diligence assessment checklists."""
    
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.openai_model
    
    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            id="due_diligence_checklist",
            name="Due Diligence Checklist",
            description="Generate a comprehensive due diligence checklist covering technical, financial, operational, and regulatory aspects of the project.",
            icon="✅",
            output_type="checklist",
            category="assessment",
            keywords=["due diligence", "checklist", "assessment", "risk", "evaluation", "audit", "review"],
        )
    
    @property
    def required_inputs(self) -> list[ToolInput]:
        # Minimal required inputs - we'll infer the rest from project description
        return []
    
    @property
    def optional_inputs(self) -> list[ToolInput]:
        # All inputs are optional - we make smart defaults
        return [
            ToolInput(
                name="project_title",
                label="Project Title",
                description="What should we call this project?",
                input_type="text",
                required=False,
                placeholder="e.g., Solar Mini-Grid Pilot in Northern Kenya",
            ),
            ToolInput(
                name="project_type",
                label="Project Type",
                description="What type of project is this?",
                input_type="select",
                required=False,
                options=["Energy Access", "Clean Cooking", "Agriculture", "Water & Sanitation", "Health", "Other"],
            ),
            ToolInput(
                name="geography",
                label="Geography",
                description="Where will this project take place?",
                input_type="text",
                required=False,
                placeholder="e.g., Kenya, Northern Region",
            ),
            ToolInput(
                name="project_stage",
                label="Project Stage",
                description="What stage is this project in?",
                input_type="select",
                required=False,
                options=["Concept/Idea", "Feasibility Study", "Pilot", "Scale-up", "Operational"],
            ),
            ToolInput(
                name="key_concerns",
                label="Key Concerns",
                description="Any specific areas you want the checklist to focus on?",
                input_type="textarea",
                required=False,
                placeholder="e.g., Regulatory compliance, community engagement",
            ),
        ]
    
    async def execute(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        inputs: dict[str, Any],
        include_corpus: bool = True,
    ) -> ToolOutput:
        """Generate the due diligence checklist."""
        from sqlalchemy import select
        from app.models.initiative import Initiative
        
        # Get initiative for context
        result = await db.execute(
            select(Initiative).where(Initiative.id == initiative_id)
        )
        initiative = result.scalar_one_or_none()
        
        # Build inputs with smart defaults from initiative
        if initiative:
            inputs.setdefault("project_title", initiative.title or "Untitled Project")
            inputs.setdefault("geography", initiative.geography or "Not specified")
            inputs.setdefault("project_type", initiative.project_type or "general")
            inputs.setdefault("project_stage", "Concept/Idea")  # Default assumption
        
        # Initialize RAG for context
        rag = RAGService(db)
        
        # Retrieve relevant context from corpus
        context_chunks = []
        if include_corpus:
            query = f"Due diligence considerations for {inputs.get('project_type', 'development')} projects in {inputs.get('geography', 'developing countries')}"
            chunks = await rag.retrieve(
                query=query,
                initiative_id=initiative_id,
                sources=["corpus"],
                corpus_top_k=5,
            )
            context_chunks = chunks
        
        # Build context string
        context = ""
        if context_chunks:
            context = "\n\nRelevant case study insights:\n"
            for i, chunk in enumerate(context_chunks):
                context += f"- {chunk.source_title}: {chunk.content[:300]}...\n"
        
        # Build project summary
        project_summary = f"""
Project: {inputs.get('project_title', 'Untitled Project')}
Type: {inputs.get('project_type', 'Not specified')}
Geography: {inputs.get('geography', 'Not specified')}
Stage: {inputs.get('project_stage', 'Not specified')}
Budget: {inputs.get('budget_range', 'Not specified')}
Implementing Organization: {inputs.get('implementing_org', 'Not specified')}
Key Concerns: {inputs.get('key_concerns', 'None specified')}
"""
        
        # Generate checklist content
        checklist_data = await self._generate_checklist(project_summary, context)
        
        # Build full checklist content
        checklist_content = {
            "title": f"Due Diligence Checklist: {inputs.get('project_title', 'Untitled Project')}",
            "date": date.today().isoformat(),
            "project_summary": {
                "title": inputs.get('project_title', 'Untitled Project'),
                "type": inputs.get('project_type', 'Not specified'),
                "geography": inputs.get('geography', 'Not specified'),
                "stage": inputs.get('project_stage', 'Not specified'),
            },
            "categories": checklist_data["categories"],
            "overall_risk_rating": checklist_data.get("overall_risk_rating", "medium"),
            "priority_items": checklist_data.get("priority_items", []),
            "next_steps": checklist_data.get("next_steps", []),
        }
        
        return ToolOutput(
            tool_id=self.definition.id,
            output_type="checklist",
            title=checklist_content["title"],
            content=checklist_content,
        )
    
    async def _generate_checklist(self, project_summary: str, context: str) -> dict:
        """Generate checklist content using GPT."""
        
        system_prompt = """You are an expert in development project due diligence. Generate a comprehensive checklist covering all aspects that should be assessed before funding or implementing a project.

Structure the checklist into clear categories:
1. Technical Feasibility
2. Financial Viability  
3. Organizational Capacity
4. Regulatory & Legal
5. Social & Environmental Impact
6. Sustainability & Exit Strategy

For each category, provide:
- 4-6 specific checklist items
- Each item should be actionable and assessable
- Include relevant questions to investigate

Also identify:
- Overall risk rating (low/medium/high)
- Top 3-5 priority items to address first
- Recommended next steps

Tailor the checklist to the specific project type and context provided."""
        
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": f"""Generate a due diligence checklist for this project.

PROJECT DETAILS:
{project_summary}
{context}

Generate a comprehensive, actionable checklist tailored to this specific project.
"""
                }
            ],
            tools=[{
                "type": "function",
                "function": {
                    "name": "generate_checklist",
                    "description": "Generate structured due diligence checklist",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "categories": {
                                "type": "array",
                                "description": "List of checklist categories",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "name": {"type": "string", "description": "Category name"},
                                        "description": {"type": "string", "description": "Brief description of what this category covers"},
                                        "items": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "item": {"type": "string", "description": "Checklist item"},
                                                    "questions": {
                                                        "type": "array",
                                                        "items": {"type": "string"},
                                                        "description": "Key questions to investigate"
                                                    },
                                                    "risk_level": {
                                                        "type": "string",
                                                        "enum": ["low", "medium", "high"],
                                                        "description": "Risk level if not addressed"
                                                    }
                                                },
                                                "required": ["item", "questions", "risk_level"]
                                            }
                                        }
                                    },
                                    "required": ["name", "description", "items"]
                                }
                            },
                            "overall_risk_rating": {
                                "type": "string",
                                "enum": ["low", "medium", "high"],
                                "description": "Overall project risk rating"
                            },
                            "priority_items": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Top priority items to address first"
                            },
                            "next_steps": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Recommended next steps"
                            }
                        },
                        "required": ["categories", "overall_risk_rating", "priority_items", "next_steps"]
                    }
                }
            }],
            tool_choice={"type": "function", "function": {"name": "generate_checklist"}},
            temperature=0.7,
        )
        
        tool_call = response.choices[0].message.tool_calls[0]
        return json.loads(tool_call.function.arguments)
