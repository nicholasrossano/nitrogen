"""Investment Memo tool - generates structured investment recommendation documents."""

from datetime import date
from typing import Any
from uuid import UUID
import json

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import get_settings
from app.tools.base import BaseTool, ToolDefinition, ToolInput, ToolOutput
from app.models.initiative import Initiative
from app.models.memo import MemoVersion, Citation
from app.services.rag import RAGService
from app.services.docx_exporter import DocxExporterService

settings = get_settings()


class InvestmentMemoTool(BaseTool):
    """Tool for generating investment memos with RAG-grounded citations."""
    
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.openai_model
    
    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            id="investment_memo",
            name="Investment Memo",
            description="Generate a structured investment recommendation with executive summary, rationale, risks, and evidence-backed citations.",
            icon="📋",
            output_type="memo",
            category="documentation",
            keywords=["investment", "memo", "recommendation", "funding", "grant", "decision"],
        )
    
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
    
    async def execute(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        inputs: dict[str, Any],
        include_corpus: bool = True,
    ) -> ToolOutput:
        """Generate the investment memo."""
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
        
        # Generate memo content
        memo_data = await self._generate_content(project_summary, context)
        
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
        
        # Build full memo content
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
    
    async def _generate_content(self, project_summary: str, context: str) -> dict:
        """Generate memo content using GPT."""
        
        system_prompt = """You are an expert analyst generating investment memos for development initiatives.

Your task is to generate a structured memo that:
1. Provides a clear recommendation (proceed, hold, or reject)
2. Grounds all claims in the provided evidence
3. Uses citation numbers [1], [2], etc. to reference specific evidence
4. Maintains a professional, objective tone
5. Highlights both opportunities and risks

CITATION RULES:
- Every factual claim should have a citation
- Use the format [1], [2], etc. inline
- Distinguish between user-provided evidence and case study corpus findings
- If evidence is limited, acknowledge uncertainty

TONE:
- Professional and analytical
- Balanced (present both pros and cons)
- Action-oriented (clear next steps)
- Concise but thorough"""
        
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": f"""Generate an investment memo for this project.

PROJECT DETAILS:
{project_summary}

EVIDENCE AND CONTEXT:
{context}

Generate a structured memo with the following sections. Use citation numbers [1], [2], etc. to reference evidence.
"""
                }
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
        
        tool_call = response.choices[0].message.tool_calls[0]
        return json.loads(tool_call.function.arguments)
    
    async def export(self, output: ToolOutput, format: str = "docx") -> str:
        """Export memo to DOCX file."""
        exporter = DocxExporterService()
        return await exporter.export_memo(output.content)
