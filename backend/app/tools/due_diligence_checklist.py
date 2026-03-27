"""Due Diligence Checklist tool - generates structured assessment checklists."""

from datetime import date
from typing import Any
from uuid import UUID
import json

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import get_settings
from app.core.llm_client import get_openai_client, record_usage_from_response
from app.tools.base import (
    BaseTool,
    ExecutionModel,
    RefinementModel,
    ReviewStrategy,
    ToolDefinition,
    ToolInput,
    ToolOutput,
    ToolAlignment,
    AlignmentSection,
    AlignmentParameter,
)
from app.services.rag import RAGService

settings = get_settings()

# Default checklist categories
DEFAULT_CHECKLIST_CATEGORIES = [
    {
        "id": "technical_feasibility",
        "title": "Technical Feasibility",
        "description": "Assess the technical viability and implementation approach",
        "default_focus_areas": [
            "Technology maturity and proven track record",
            "Technical specifications and requirements",
            "Infrastructure needs and dependencies",
            "Maintenance and operational requirements",
        ],
    },
    {
        "id": "financial_viability",
        "title": "Financial Viability",
        "description": "Evaluate financial projections and sustainability",
        "default_focus_areas": [
            "Revenue model and pricing strategy",
            "Cost structure and margins",
            "Funding requirements and use of funds",
            "Financial projections and assumptions",
        ],
    },
    {
        "id": "organizational_capacity",
        "title": "Organizational Capacity",
        "description": "Assess the team and organizational readiness",
        "default_focus_areas": [
            "Team experience and track record",
            "Governance and management structure",
            "Partnerships and stakeholder relationships",
            "Operational capacity and systems",
        ],
    },
    {
        "id": "regulatory_legal",
        "title": "Regulatory & Legal",
        "description": "Review compliance and legal considerations",
        "default_focus_areas": [
            "Permits and licenses required",
            "Regulatory compliance status",
            "Legal structure and ownership",
            "Contractual arrangements",
        ],
    },
    {
        "id": "social_environmental",
        "title": "Social & Environmental Impact",
        "description": "Evaluate impact and community considerations",
        "default_focus_areas": [
            "Target beneficiary identification",
            "Community engagement approach",
            "Environmental safeguards",
            "Social impact measurement",
        ],
    },
    {
        "id": "sustainability_exit",
        "title": "Sustainability & Exit",
        "description": "Assess long-term viability and exit strategy",
        "default_focus_areas": [
            "Path to financial sustainability",
            "Scale-up potential",
            "Exit or transition strategy",
            "Knowledge transfer and capacity building",
        ],
    },
]


class DueDiligenceChecklistTool(BaseTool):
    """Tool for generating due diligence assessment checklists."""
    
    def __init__(self, user_id: str | None = None, db: AsyncSession | None = None):
        self.user_id = user_id
        self.db = db
        self._client: AsyncOpenAI | None = None
        self._is_byok: bool = False
        self.model = settings.openai_model

    async def _get_client(self) -> AsyncOpenAI:
        if self._client is None:
            self._client, self._is_byok = await get_openai_client(self.user_id, self.db)
        return self._client
    
    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            id="due_diligence_checklist",
            name="Due Diligence Checklist",
            description="Checklist covering technical, financial, operational, and regulatory aspects of the project",
            icon="CheckSquare",
            output_type="checklist",
            category="assessment",
            keywords=["due diligence", "checklist", "assessment", "risk", "evaluation", "audit", "review"],
            export_format="xlsx",
        )
    
    @property
    def review_strategy(self) -> ReviewStrategy:
        return ReviewStrategy.OUTLINE_REVIEW

    @property
    def execution_model(self) -> ExecutionModel:
        return ExecutionModel.ASYNC_LLM_GENERATION

    @property
    def refinement_model(self) -> RefinementModel:
        return RefinementModel.FEEDBACK_AND_REGENERATE
    
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
    
    async def generate_alignment(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        inputs: dict[str, Any],
    ) -> ToolAlignment:
        """
        Generate proposed checklist categories and focus areas based on project context.
        """
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
            inputs.setdefault("project_stage", "Concept/Idea")
        
        project_title = inputs.get("project_title", "Untitled Project")
        
        # Build project summary for LLM
        project_summary = f"""
Project: {project_title}
Type: {inputs.get('project_type', 'development')}
Geography: {inputs.get('geography', 'Not specified')}
Stage: {inputs.get('project_stage', 'Not specified')}
Key Concerns: {inputs.get('key_concerns', 'None specified')}
"""
        
        # Use LLM to generate context-aware focus areas
        try:
            alignment_data = await self._generate_checklist_alignment(project_summary)
        except Exception as e:
            import logging
            logging.error(f"Failed to generate checklist alignment: {e}")
            alignment_data = self._get_default_alignment()
        
        # Build alignment sections from categories
        sections = []
        for i, category_data in enumerate(alignment_data.get("categories", [])):
            sections.append(AlignmentSection(
                id=category_data.get("id", f"category_{i}"),
                title=category_data.get("title", f"Category {i+1}"),
                description=category_data.get("description", ""),
                key_points=category_data.get("focus_areas", []),
                include=category_data.get("include", True),
                order=i,
            ))
        
        # Build alignment parameters
        parameters = [
            AlignmentParameter(
                name="detail_level",
                label="Detail Level",
                description="How detailed should each checklist item be",
                param_type="select",
                value=alignment_data.get("detail_level", "standard"),
                options=["brief", "standard", "detailed"],
            ),
            AlignmentParameter(
                name="risk_focus",
                label="Risk Focus",
                description="Emphasis on risk identification",
                param_type="select",
                value=alignment_data.get("risk_focus", "balanced"),
                options=["opportunity-focused", "balanced", "risk-focused"],
            ),
        ]
        
        return ToolAlignment(
            tool_id=self.definition.id,
            title=f"Due Diligence Checklist: {project_title}",
            description="Review the checklist categories below. You can enable/disable categories, adjust focus areas, or add specific items you want covered.",
            sections=sections,
            parameters=parameters,
            assumptions=alignment_data.get("assumptions", []),
            confirmed=False,
        )
    
    async def _generate_checklist_alignment(self, project_summary: str) -> dict:
        """Use LLM to generate context-aware checklist categories."""
        client = await self._get_client()
        system_prompt = """You are an expert in due diligence for development projects.

Given a project description, generate tailored checklist categories and focus areas.

For each category:
- Provide a clear title and description
- List 3-5 specific focus areas tailored to THIS project
- Indicate if this category is particularly relevant (include=true) or can be optional

Also identify:
- Key assumptions being made
- Recommended detail level (brief, standard, detailed)
- Risk focus level (opportunity-focused, balanced, risk-focused)

Tailor everything to the specific project type, geography, and stage."""

        response = await client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": f"""Generate a due diligence checklist structure for this project:

{project_summary}

Create categories and focus areas tailored to this specific project type and context.
"""
                }
            ],
            tools=[{
                "type": "function",
                "function": {
                    "name": "generate_alignment",
                    "description": "Generate checklist alignment structure",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "categories": {
                                "type": "array",
                                "description": "Checklist categories in order of priority",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "id": {"type": "string", "description": "Category identifier (e.g., technical_feasibility)"},
                                        "title": {"type": "string", "description": "Category title"},
                                        "description": {"type": "string", "description": "What this category covers"},
                                        "focus_areas": {
                                            "type": "array",
                                            "items": {"type": "string"},
                                            "description": "Specific areas to assess in this category"
                                        },
                                        "include": {"type": "boolean", "description": "Whether this category is essential"},
                                    },
                                    "required": ["id", "title", "description", "focus_areas", "include"]
                                }
                            },
                            "assumptions": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Key assumptions being made"
                            },
                            "detail_level": {
                                "type": "string",
                                "enum": ["brief", "standard", "detailed"],
                                "description": "Recommended detail level"
                            },
                            "risk_focus": {
                                "type": "string",
                                "enum": ["opportunity-focused", "balanced", "risk-focused"],
                                "description": "How much to emphasize risk vs opportunity"
                            }
                        },
                        "required": ["categories", "assumptions", "detail_level", "risk_focus"]
                    }
                }
            }],
            tool_choice={"type": "function", "function": {"name": "generate_alignment"}},
            temperature=0.7,
        )
        if self.user_id and self.db:
            await record_usage_from_response(self.user_id, self.model, response, self.db, is_byok=self._is_byok)
        
        tool_call = response.choices[0].message.tool_calls[0]
        return json.loads(tool_call.function.arguments)
    
    def _get_default_alignment(self) -> dict:
        """Return default checklist alignment structure."""
        categories = []
        for i, category in enumerate(DEFAULT_CHECKLIST_CATEGORIES):
            categories.append({
                "id": category["id"],
                "title": category["title"],
                "description": category["description"],
                "focus_areas": category["default_focus_areas"],
                "include": True,
            })
        
        return {
            "categories": categories,
            "assumptions": [
                "Project information is current and accurate",
                "Standard regulatory environment applies",
                "No major external shocks expected",
            ],
            "detail_level": "standard",
            "risk_focus": "balanced",
        }
    
    async def update_alignment_from_feedback(
        self,
        current_alignment: ToolAlignment,
        feedback: str,
        db: AsyncSession,
        initiative_id: UUID,
    ) -> ToolAlignment:
        """Update checklist alignment based on user feedback."""
        
        # Build current structure for LLM
        current_structure = {
            "categories": [s.to_dict() for s in current_alignment.sections],
        }
        
        system_prompt = """You are refining a due diligence checklist based on user feedback.

Given the current checklist and the user's feedback, return an updated checklist that incorporates their requested changes while keeping everything else as close to the original as possible.

The user might ask to:
- Change a specific category (rename it, adjust its focus areas, etc.)
- Add or remove categories
- Shift emphasis across the whole checklist
- Or anything else

Apply their feedback thoughtfully. If they ask to change one thing, change that thing. If they ask for broader changes, make broader changes. Keep the rest intact."""

        try:
            client = await self._get_client()
            response = await client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": f"""Current checklist:
{json.dumps(current_structure, indent=2)}

User's feedback: "{feedback}"

Return the updated checklist.
"""
                    }
                ],
                tools=[{
                    "type": "function",
                    "function": {
                        "name": "update_checklist",
                        "description": "Return the updated checklist",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "categories": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "id": {"type": "string"},
                                            "title": {"type": "string"},
                                            "description": {"type": "string"},
                                            "focus_areas": {"type": "array", "items": {"type": "string"}},
                                            "include": {"type": "boolean"},
                                        },
                                        "required": ["id", "title", "description", "focus_areas", "include"]
                                    }
                                },
                            },
                            "required": ["categories"]
                        }
                    }
                }],
                tool_choice={"type": "function", "function": {"name": "update_checklist"}},
                temperature=0.4,
            )
            if self.user_id and self.db:
                await record_usage_from_response(self.user_id, self.model, response, self.db, is_byok=self._is_byok)
            
            tool_call = response.choices[0].message.tool_calls[0]
            updated_data = json.loads(tool_call.function.arguments)
            
            # Build sections from LLM response
            sections = []
            for i, category_data in enumerate(updated_data.get("categories", [])):
                sections.append(AlignmentSection(
                    id=category_data.get("id", f"category_{i}"),
                    title=category_data.get("title", f"Category {i+1}"),
                    description=category_data.get("description", ""),
                    key_points=category_data.get("focus_areas", []),
                    include=category_data.get("include", True),
                    order=i,
                ))
            
            current_alignment.sections = sections
            current_alignment.feedback = None
            
            return current_alignment
            
        except Exception as e:
            import logging
            logging.error(f"Failed to update alignment from feedback: {e}")
            current_alignment.feedback = feedback
            return current_alignment
    
    async def execute(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        inputs: dict[str, Any],
        include_corpus: bool = True,
        alignment: ToolAlignment | None = None,
    ) -> ToolOutput:
        """Generate the due diligence checklist, optionally using alignment configuration."""
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
        
        # Build alignment instructions if provided
        alignment_instructions = None
        if alignment:
            alignment_instructions = self._build_alignment_instructions(alignment)
        
        # Generate checklist content
        checklist_data = await self._generate_checklist(project_summary, context, alignment_instructions)
        
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
    
    def _build_alignment_instructions(self, alignment: ToolAlignment) -> str:
        """Build generation instructions from alignment configuration."""
        instructions = []
        
        # Category structure
        instructions.append("CHECKLIST STRUCTURE (follow this structure):")
        for section in sorted(alignment.sections, key=lambda s: s.order):
            if section.include:
                instructions.append(f"\n## {section.title}")
                instructions.append(f"   {section.description}")
                if section.key_points:
                    instructions.append("   Focus areas to cover:")
                    for point in section.key_points:
                        instructions.append(f"   - {point}")
        
        # Parameters
        for param in alignment.parameters:
            if param.name == "detail_level":
                if param.value == "brief":
                    instructions.append("\nDETAIL: Brief - keep checklist items concise")
                elif param.value == "detailed":
                    instructions.append("\nDETAIL: Detailed - provide comprehensive questions for each item")
                else:
                    instructions.append("\nDETAIL: Standard - moderate detail level")
            elif param.name == "risk_focus":
                if param.value == "opportunity-focused":
                    instructions.append("FOCUS: Opportunity-focused - emphasize potential and upside")
                elif param.value == "risk-focused":
                    instructions.append("FOCUS: Risk-focused - emphasize risks and due diligence depth")
                else:
                    instructions.append("FOCUS: Balanced - cover both risks and opportunities")
        
        # Assumptions
        if alignment.assumptions:
            instructions.append("\nKEY ASSUMPTIONS:")
            for assumption in alignment.assumptions:
                instructions.append(f"- {assumption}")
        
        return "\n".join(instructions)
    
    async def _generate_checklist(self, project_summary: str, context: str, alignment_instructions: str | None = None) -> dict:
        """Generate checklist content using GPT."""
        client = await self._get_client()
        
        base_system_prompt = """You are an expert in development project due diligence. Generate a comprehensive checklist covering all aspects that should be assessed before funding or implementing a project.

For each category, provide:
- 4-6 specific checklist items
- Each item should be actionable and assessable
- Include relevant questions to investigate

Also identify:
- Overall risk rating (low/medium/high)
- Top 3-5 priority items to address first
- Recommended next steps

Tailor the checklist to the specific project type and context provided."""
        
        # Add alignment instructions if provided
        if alignment_instructions:
            system_prompt = f"""{base_system_prompt}

USER-SPECIFIED STRUCTURE AND PREFERENCES:
{alignment_instructions}

Follow the user's specified structure and focus areas closely."""
        else:
            system_prompt = f"""{base_system_prompt}

Structure the checklist into clear categories:
1. Technical Feasibility
2. Financial Viability  
3. Organizational Capacity
4. Regulatory & Legal
5. Social & Environmental Impact
6. Sustainability & Exit Strategy"""
        
        user_message = f"""Generate a due diligence checklist for this project.

PROJECT DETAILS:
{project_summary}
{context}

Generate a comprehensive, actionable checklist tailored to this specific project."""
        
        if alignment_instructions:
            user_message += "\n\nFollow the specified structure and focus areas from the alignment instructions."
        
        response = await client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
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
        if self.user_id and self.db:
            await record_usage_from_response(self.user_id, self.model, response, self.db, is_byok=self._is_byok)
        
        tool_call = response.choices[0].message.tool_calls[0]
        return json.loads(tool_call.function.arguments)
