"""Investment Memo tool - generates structured investment recommendation documents."""

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
from app.models.initiative import Initiative
from app.models.memo import MemoVersion, Citation
from app.services.rag import RAGService
from app.services.docx_exporter import DocxExporterService

settings = get_settings()

# Default memo sections with their descriptions
DEFAULT_MEMO_SECTIONS = [
    {
        "id": "executive_summary",
        "title": "Executive Summary",
        "description": "2-3 paragraph overview of the project and key recommendation",
        "default_points": [
            "Project overview and context",
            "Investment ask and use of funds",
            "Key value proposition",
            "Summary recommendation",
        ],
    },
    {
        "id": "recommendation",
        "title": "Recommendation",
        "description": "Clear recommendation (proceed, hold, or reject) with confidence level",
        "default_points": [
            "Decision: proceed / hold / reject",
            "Confidence level and key factors",
            "Conditions or prerequisites",
        ],
    },
    {
        "id": "recommendation_rationale",
        "title": "Rationale",
        "description": "Detailed justification for the recommendation with evidence",
        "default_points": [
            "Strategic alignment",
            "Track record and team capacity",
            "Market opportunity",
            "Path to impact and sustainability",
        ],
    },
    {
        "id": "evidence_summary",
        "title": "Evidence Summary",
        "description": "Summary of supporting evidence and comparable case studies",
        "default_points": [
            "Key findings from submitted materials",
            "Relevant case study insights",
            "Data quality and gaps",
        ],
    },
    {
        "id": "risks_and_assumptions",
        "title": "Risks & Assumptions",
        "description": "Critical risks and key assumptions underlying the analysis",
        "default_points": [
            "Technical risks",
            "Financial/market risks",
            "Operational risks",
            "Key assumptions to validate",
        ],
    },
    {
        "id": "open_questions",
        "title": "Open Questions",
        "description": "Outstanding questions that need to be addressed",
        "default_points": [
            "Information gaps",
            "Due diligence items",
            "Clarifications needed from applicant",
        ],
    },
]


class InvestmentMemoTool(BaseTool):
    """Tool for generating investment memos with RAG-grounded citations."""
    
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
            id="investment_memo",
            name="Investment Memo",
            description="Structured memo with executive summary, rationale, risks, and evidence-backed citations",
            icon="FileText",
            output_type="memo",
            category="documentation",
            keywords=["investment", "memo", "recommendation", "funding", "grant", "decision"],
            export_format="docx",
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
        # All inputs are optional - we make smart defaults from the project description
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
                name="geography",
                label="Geography",
                description="Where will this project take place?",
                input_type="text",
                required=False,
                placeholder="e.g., Kenya, Northern Region",
            ),
            ToolInput(
                name="target_beneficiaries",
                label="Target Beneficiaries",
                description="Who will benefit from this project?",
                input_type="textarea",
                required=False,
                placeholder="e.g., Rural households without grid access",
            ),
            ToolInput(
                name="project_goal",
                label="Project Goal",
                description="What is the main objective of this project?",
                input_type="textarea",
                required=False,
                placeholder="e.g., Provide reliable electricity access",
            ),
            ToolInput(
                name="budget_range",
                label="Budget Range",
                description="What is the expected budget?",
                input_type="text",
                required=False,
                placeholder="e.g., $500,000 - $750,000",
            ),
            ToolInput(
                name="key_risks",
                label="Key Risks or Constraints",
                description="Any known risks or constraints to consider?",
                input_type="textarea",
                required=False,
                placeholder="e.g., Regulatory approval pending",
            ),
        ]
    
    async def generate_alignment(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        inputs: dict[str, Any],
    ) -> ToolAlignment:
        """
        Generate a proposed memo outline based on project context.
        
        Uses LLM to create a context-aware outline with intelligent defaults.
        """
        # Get initiative for context
        result = await db.execute(
            select(Initiative).where(Initiative.id == initiative_id)
        )
        initiative = result.scalar_one_or_none()
        
        # Build inputs with smart defaults from initiative
        if initiative:
            inputs.setdefault("project_title", initiative.title or "Untitled Project")
            inputs.setdefault("geography", initiative.geography or "Not specified")
            inputs.setdefault("target_beneficiaries", initiative.target_population or "Target communities")
            inputs.setdefault("project_goal", initiative.goal or initiative.project_description or "Project objectives")
        
        project_title = inputs.get("project_title", "Untitled Project")
        
        # Build project summary for LLM
        project_summary = f"""
Project: {project_title}
Type: {initiative.project_type if initiative else 'development'}
Geography: {inputs.get('geography', 'Not specified')}
Target Beneficiaries: {inputs.get('target_beneficiaries', 'Not specified')}
Goal: {inputs.get('project_goal', 'Not specified')}
Budget: {inputs.get('budget_range', 'Not specified')}
Known Risks/Constraints: {inputs.get('key_risks', 'None specified')}
"""
        
        # Use LLM to generate context-aware outline
        try:
            outline_data = await self._generate_outline(project_summary)
        except Exception as e:
            # Fall back to default outline if LLM fails
            import logging
            logging.error(f"Failed to generate memo outline: {e}")
            outline_data = self._get_default_outline()
        
        # Build alignment sections from outline
        sections = []
        for i, section_data in enumerate(outline_data.get("sections", [])):
            sections.append(AlignmentSection(
                id=section_data.get("id", f"section_{i}"),
                title=section_data.get("title", f"Section {i+1}"),
                description=section_data.get("description", ""),
                key_points=section_data.get("key_points", []),
                include=section_data.get("include", True),
                order=i,
            ))
        
        # Build alignment parameters
        parameters = [
            AlignmentParameter(
                name="tone",
                label="Tone",
                description="Writing style for the memo",
                param_type="select",
                value=outline_data.get("tone", "balanced"),
                options=["conservative", "balanced", "optimistic"],
            ),
            AlignmentParameter(
                name="detail_level",
                label="Detail Level",
                description="How detailed should the memo be",
                param_type="select",
                value=outline_data.get("detail_level", "standard"),
                options=["concise", "standard", "comprehensive"],
            ),
        ]
        
        return ToolAlignment(
            tool_id=self.definition.id,
            title=f"Investment Memo Outline: {project_title}",
            description="Review the proposed memo structure below. You can adjust sections, add specific points to cover, or request changes.",
            sections=sections,
            parameters=parameters,
            assumptions=outline_data.get("assumptions", []),
            confirmed=False,
        )
    
    async def _generate_outline(self, project_summary: str) -> dict:
        """Use LLM to generate a context-aware memo outline."""
        client = await self._get_client()
        system_prompt = """You are an expert at structuring investment memos for development projects.

Given a project description, generate a tailored memo outline that will help the user understand what the memo will cover.

For each section, provide:
- A clear title
- A brief description of what it covers
- 3-5 specific key points that should be addressed for THIS project

Also identify:
- Key assumptions being made (2-3 items)
- Recommended tone (conservative, balanced, or optimistic)
- Detail level (concise, standard, or comprehensive)

Tailor the key points to the specific project context - don't just use generic points."""

        response = await client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": f"""Generate a memo outline for this project:

{project_summary}

Create a structured outline with sections tailored to this specific project type and context.
"""
                }
            ],
            tools=[{
                "type": "function",
                "function": {
                    "name": "generate_outline",
                    "description": "Generate a structured memo outline",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "sections": {
                                "type": "array",
                                "description": "Memo sections in order",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "id": {"type": "string", "description": "Section identifier (e.g., executive_summary)"},
                                        "title": {"type": "string", "description": "Section title"},
                                        "description": {"type": "string", "description": "What this section covers"},
                                        "key_points": {
                                            "type": "array",
                                            "items": {"type": "string"},
                                            "description": "Specific points to cover in this section"
                                        },
                                        "include": {"type": "boolean", "description": "Whether to include this section"},
                                    },
                                    "required": ["id", "title", "description", "key_points", "include"]
                                }
                            },
                            "assumptions": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Key assumptions being made"
                            },
                            "tone": {
                                "type": "string",
                                "enum": ["conservative", "balanced", "optimistic"],
                                "description": "Recommended tone for the memo"
                            },
                            "detail_level": {
                                "type": "string",
                                "enum": ["concise", "standard", "comprehensive"],
                                "description": "Recommended detail level"
                            }
                        },
                        "required": ["sections", "assumptions", "tone", "detail_level"]
                    }
                }
            }],
            tool_choice={"type": "function", "function": {"name": "generate_outline"}},
            temperature=0.7,
        )
        if self.user_id and self.db:
            await record_usage_from_response(self.user_id, self.model, response, self.db, is_byok=self._is_byok)
        
        tool_call = response.choices[0].message.tool_calls[0]
        return json.loads(tool_call.function.arguments)
    
    def _get_default_outline(self) -> dict:
        """Return default memo outline structure."""
        sections = []
        for i, section in enumerate(DEFAULT_MEMO_SECTIONS):
            sections.append({
                "id": section["id"],
                "title": section["title"],
                "description": section["description"],
                "key_points": section["default_points"],
                "include": True,
            })
        
        return {
            "sections": sections,
            "assumptions": [
                "Information provided is accurate and complete",
                "Market conditions remain stable",
                "No major regulatory changes expected",
            ],
            "tone": "balanced",
            "detail_level": "standard",
        }
    
    async def update_alignment_from_feedback(
        self,
        current_alignment: ToolAlignment,
        feedback: str,
        db: AsyncSession,
        initiative_id: UUID,
    ) -> ToolAlignment:
        """Update memo outline based on user feedback."""
        
        # Build current outline for LLM
        current_outline = {
            "sections": [s.to_dict() for s in current_alignment.sections],
        }
        
        system_prompt = """You are refining an investment memo outline based on user feedback.

Given the current outline and the user's feedback, return an updated outline that incorporates their requested changes while keeping everything else as close to the original as possible.

The user might ask to:
- Change a specific section (rename it, adjust its focus, etc.)
- Add or remove sections
- Shift emphasis across the whole outline
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
                        "content": f"""Current outline:
{json.dumps(current_outline, indent=2)}

User's feedback: "{feedback}"

Return the updated outline.
"""
                    }
                ],
                tools=[{
                    "type": "function",
                    "function": {
                        "name": "update_outline",
                        "description": "Return the updated outline",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "sections": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "id": {"type": "string"},
                                            "title": {"type": "string"},
                                            "description": {"type": "string"},
                                            "key_points": {"type": "array", "items": {"type": "string"}},
                                            "include": {"type": "boolean"},
                                        },
                                        "required": ["id", "title", "description", "key_points", "include"]
                                    }
                                },
                            },
                            "required": ["sections"]
                        }
                    }
                }],
                tool_choice={"type": "function", "function": {"name": "update_outline"}},
                temperature=0.4,
            )
            if self.user_id and self.db:
                await record_usage_from_response(self.user_id, self.model, response, self.db, is_byok=self._is_byok)
            
            tool_call = response.choices[0].message.tool_calls[0]
            updated_data = json.loads(tool_call.function.arguments)
            
            # Build sections from LLM response
            sections = []
            for i, section_data in enumerate(updated_data.get("sections", [])):
                sections.append(AlignmentSection(
                    id=section_data.get("id", f"section_{i}"),
                    title=section_data.get("title", f"Section {i+1}"),
                    description=section_data.get("description", ""),
                    key_points=section_data.get("key_points", []),
                    include=section_data.get("include", True),
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
        """Generate the investment memo, optionally using alignment configuration."""
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
            inputs.setdefault("target_beneficiaries", initiative.target_population or "Target communities")
            inputs.setdefault("project_goal", initiative.goal or initiative.project_description or "Project objectives")
        
        # Initialize RAG
        rag = RAGService(db)
        
        # Retrieve relevant chunks
        section_chunks = await rag.retrieve_for_memo_sections(
            initiative_id=initiative_id,
            include_corpus=include_corpus,
        )
        
        # Build citation map
        all_chunks = []
        seen_ids = set()
        for chunks in section_chunks.values():
            for chunk in chunks:
                if chunk.chunk_id not in seen_ids:
                    all_chunks.append(chunk)
                    seen_ids.add(chunk.chunk_id)
        
        citation_map = {
            chunk.chunk_id: i + 1 
            for i, chunk in enumerate(all_chunks)
        }
        
        # Build context from chunks
        context = self._build_context(section_chunks, citation_map)
        
        # Build project summary from inputs
        project_summary = f"""
Project: {inputs.get('project_title', 'Untitled Project')}
Geography: {inputs.get('geography', 'Not specified')}
Target Beneficiaries: {inputs.get('target_beneficiaries', 'Not specified')}
Goal: {inputs.get('project_goal', 'Not specified')}
Budget: {inputs.get('budget_range', 'Not specified')}
Timeline: {inputs.get('timeline', 'Not specified')}
Known Risks/Constraints: {inputs.get('key_risks', 'None specified')}
"""
        
        # Build alignment instructions if provided
        alignment_instructions = None
        if alignment:
            alignment_instructions = self._build_alignment_instructions(alignment)
        
        # Get valid citation numbers (only cite what we actually have)
        valid_citations = list(citation_map.values()) if citation_map else []
        
        # Generate memo content
        memo_data = await self._generate_content(project_summary, context, alignment_instructions, alignment, valid_citations)
        
        # Build citations list
        citations = [
            {
                "number": citation_map[chunk.chunk_id],
                "source_type": chunk.source_type,
                "source_title": chunk.source_title,
                "excerpt": chunk.content[:300] + "..." if len(chunk.content) > 300 else chunk.content,
                "chunk_id": str(chunk.chunk_id),
            }
            for chunk in all_chunks
        ]
        
        # Build full memo content - support both dynamic sections and legacy format
        if "sections" in memo_data:
            # Dynamic sections from alignment
            memo_content = {
                "title": f"Investment Memo: {inputs.get('project_title', 'Untitled Project')}",
                "date": date.today().isoformat(),
                "recommendation": memo_data.get("recommendation", "hold"),
                "sections": memo_data["sections"],
                "citations": citations,
            }
        else:
            # Legacy hardcoded format
            memo_content = {
                "title": f"Investment Memo: {inputs.get('project_title', 'Untitled Project')}",
                "date": date.today().isoformat(),
                "executive_summary": memo_data["executive_summary"],
                "recommendation": memo_data["recommendation"],
                "recommendation_rationale": memo_data["recommendation_rationale"],
                "evidence_summary": memo_data["evidence_summary"],
                "risks_and_assumptions": memo_data["risks_and_assumptions"],
                "open_questions": memo_data.get("open_questions", []),
                "citations": citations,
            }
        
        # Save to database
        memo_version = MemoVersion(
            initiative_id=initiative_id,
            content=memo_content,
        )
        db.add(memo_version)
        await db.commit()
        await db.refresh(memo_version)
        
        # Save citations
        for chunk in all_chunks:
            citation_obj = Citation(
                memo_version_id=memo_version.id,
                section_name="all",
                citation_number=citation_map[chunk.chunk_id],
                chunk_id=chunk.chunk_id,
                source_type=chunk.source_type,
                excerpt=chunk.content[:500],
            )
            db.add(citation_obj)
        await db.commit()
        
        return ToolOutput(
            tool_id=self.definition.id,
            output_type="memo",
            title=memo_content["title"],
            content=memo_content,
        )
    
    def _build_context(self, section_chunks: dict, citation_map: dict) -> str:
        """Build context string from retrieved chunks."""
        context_parts = []
        
        for section, chunks in section_chunks.items():
            if chunks:
                section_context = f"\n--- Evidence for {section.replace('_', ' ').title()} ---\n"
                for chunk in chunks:
                    citation_num = citation_map[chunk.chunk_id]
                    source_label = f"[{chunk.source_type.upper()}]" if chunk.source_type == "corpus" else "[EVIDENCE]"
                    section_context += f"\n[{citation_num}] {source_label} {chunk.source_title}:\n{chunk.content}\n"
                context_parts.append(section_context)
        
        return "\n".join(context_parts)
    
    def _build_alignment_instructions(self, alignment: ToolAlignment) -> str:
        """Build generation instructions from alignment configuration."""
        instructions = []
        
        # Section structure
        instructions.append("MEMO STRUCTURE (follow this outline):")
        for section in sorted(alignment.sections, key=lambda s: s.order):
            if section.include:
                instructions.append(f"\n## {section.title}")
                instructions.append(f"   {section.description}")
                if section.key_points:
                    instructions.append("   Key points to address:")
                    for point in section.key_points:
                        instructions.append(f"   - {point}")
        
        # Parameters
        for param in alignment.parameters:
            if param.name == "tone":
                if param.value == "conservative":
                    instructions.append("\nTONE: Conservative - emphasize risks and uncertainties, be cautious with claims")
                elif param.value == "optimistic":
                    instructions.append("\nTONE: Optimistic - highlight opportunities and potential, while still noting risks")
                else:
                    instructions.append("\nTONE: Balanced - present both opportunities and risks objectively")
            elif param.name == "detail_level":
                if param.value == "concise":
                    instructions.append("LENGTH: Concise - keep sections brief and focused")
                elif param.value == "comprehensive":
                    instructions.append("LENGTH: Comprehensive - provide detailed analysis in each section")
                else:
                    instructions.append("LENGTH: Standard - moderate detail level")
        
        # Assumptions to note
        if alignment.assumptions:
            instructions.append("\nKEY ASSUMPTIONS TO ACKNOWLEDGE:")
            for assumption in alignment.assumptions:
                instructions.append(f"- {assumption}")
        
        return "\n".join(instructions)
    
    async def _generate_content(self, project_summary: str, context: str, alignment_instructions: str | None = None, alignment: "ToolAlignment | None" = None, valid_citations: list[int] | None = None) -> dict:
        """Generate memo content using GPT."""
        client = await self._get_client()
        
        # Build citation rules based on what's actually available
        if valid_citations and len(valid_citations) > 0:
            citation_list = ", ".join(f"[{n}]" for n in sorted(valid_citations))
            citation_rules = f"""CITATION RULES - CRITICAL:
- You may ONLY use these citation numbers: {citation_list}
- Do NOT invent or hallucinate citations. If you cite [X], it MUST be one of the numbers above.
- If making a claim that isn't supported by the provided evidence, do NOT add a citation - instead phrase it as analysis or recommendation.
- Every citation number you use must correspond to evidence provided below."""
        else:
            citation_rules = """CITATION RULES:
- No evidence citations are available for this memo.
- Do NOT use citation numbers like [1], [2], etc.
- Clearly state when claims are based on general knowledge vs. specific evidence."""
        
        base_system_prompt = f"""You are an expert analyst generating investment memos for development initiatives.

Your task is to generate a structured memo that:
1. Provides a clear recommendation (proceed, hold, or reject)
2. Grounds claims in the provided evidence WHERE AVAILABLE
3. Maintains a professional, objective tone
4. Highlights both opportunities and risks

{citation_rules}"""
        
        # Add alignment instructions if provided
        if alignment_instructions:
            system_prompt = f"""{base_system_prompt}

USER-SPECIFIED STRUCTURE AND PREFERENCES:
{alignment_instructions}

Follow the user's specified structure and preferences closely. Generate content for EACH section specified."""
        else:
            system_prompt = f"""{base_system_prompt}

TONE:
- Professional and analytical
- Balanced (present both pros and cons)
- Action-oriented (clear next steps)
- Concise but thorough"""
        
        user_message = f"""Generate an investment memo for this project.

PROJECT DETAILS:
{project_summary}

EVIDENCE AND CONTEXT:
{context}

Generate a structured memo. Use citation numbers [1], [2], etc. to reference evidence."""
        
        if alignment_instructions:
            user_message += "\n\nGenerate content for EACH section from the alignment. Return a 'sections' array with content for each section."
        
        # Build dynamic schema based on alignment sections if provided
        if alignment and alignment.sections:
            # Dynamic schema based on user's custom sections
            response = await client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message}
                ],
                tools=[{
                    "type": "function",
                    "function": {
                        "name": "generate_memo",
                        "description": "Generate structured investment memo with custom sections",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "recommendation": {
                                    "type": "string",
                                    "enum": ["proceed", "hold", "reject"],
                                    "description": "Overall recommendation"
                                },
                                "sections": {
                                    "type": "array",
                                    "description": "Content for each section in the outline",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "id": {"type": "string", "description": "Section ID from the outline"},
                                            "title": {"type": "string", "description": "Section title"},
                                            "content": {"type": "string", "description": "Full content for this section with citations"}
                                        },
                                        "required": ["id", "title", "content"]
                                    }
                                }
                            },
                            "required": ["recommendation", "sections"]
                        }
                    }
                }],
                tool_choice={"type": "function", "function": {"name": "generate_memo"}},
                temperature=0.7,
            )
        else:
            # Default hardcoded schema
            response = await client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message}
                ],
                tools=[{
                    "type": "function",
                    "function": {
                        "name": "generate_memo",
                        "description": "Generate structured investment memo",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "executive_summary": {
                                    "type": "string",
                                    "description": "2-3 paragraph executive summary of the project and recommendation"
                                },
                                "recommendation": {
                                    "type": "string",
                                    "enum": ["proceed", "hold", "reject"],
                                    "description": "Overall recommendation"
                                },
                                "recommendation_rationale": {
                                    "type": "string",
                                    "description": "Detailed rationale for the recommendation with citations"
                                },
                                "evidence_summary": {
                                    "type": "string",
                                    "description": "Summary of supporting evidence with citations"
                                },
                                "risks_and_assumptions": {
                                    "type": "string",
                                    "description": "Key risks and assumptions with citations where relevant"
                                },
                                "open_questions": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "List of open questions that need to be addressed"
                                }
                            },
                            "required": ["executive_summary", "recommendation", "recommendation_rationale", "evidence_summary", "risks_and_assumptions", "open_questions"]
                        }
                    }
                }],
                tool_choice={"type": "function", "function": {"name": "generate_memo"}},
                temperature=0.7,
            )
        
        if self.user_id and self.db:
            await record_usage_from_response(self.user_id, self.model, response, self.db, is_byok=self._is_byok)
        tool_call = response.choices[0].message.tool_calls[0]
        return json.loads(tool_call.function.arguments)
    
    async def export(self, output: ToolOutput, format: str = "docx") -> str:
        """Export memo to DOCX file."""
        exporter = DocxExporterService()
        return await exporter.export_memo(output.content)
