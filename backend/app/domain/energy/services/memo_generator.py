from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import date
from pathlib import Path
import json

from app.config import get_settings
from app.core.llm_invoke import acompletion
from app.core.model_catalog import Complexity, ModelRole
from app.domain.resolver import get_domain_prompt_path
from app.models.project import Project
from app.models.memo import Citation
from app.schemas.memo import MemoContent, CitationResponse
from app.services.rag import RAGService, RetrievedChunk

settings = get_settings()


class MemoGeneratorService:
    """Service for generating investment memos using RAG"""
    
    def __init__(self, db: AsyncSession, user_id: str | None = None):
        self.db = db
        self.user_id = user_id
        self._client: AsyncOpenAI | None = None
        self._is_byok: bool = False
        self.model = settings.openai_model
        self.rag = RAGService(db, user_id=user_id)

    async def _get_client(self) -> AsyncOpenAI:
        if self._client is None:
            self._client, self._is_byok = await get_openai_client(self.user_id, self.db)
        return self._client
    
    async def generate(
        self,
        initiative: Project,
        include_corpus: bool = True,
    ) -> tuple[MemoContent, list[Citation]]:
        """Generate a memo with RAG-grounded citations"""
        # Retrieve relevant chunks for each section
        section_chunks = await self.rag.retrieve_for_memo_sections(
            project_id=initiative.id,
            include_corpus=include_corpus,
        )
        
        # Build citation map (chunk_id -> citation number)
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
        
        # Generate memo content
        memo_content = await self._generate_memo_content(
            initiative=initiative,
            section_chunks=section_chunks,
            citation_map=citation_map,
        )
        
        # Build citations
        citations = [
            Citation(
                section_name="all",  # We'll track per-section in the future
                citation_number=citation_map[chunk.chunk_id],
                chunk_id=chunk.chunk_id,
                source_type=chunk.source_type,
                excerpt=chunk.content[:500],  # Truncate for storage
            )
            for chunk in all_chunks
        ]
        
        # Add citations to memo content
        memo_content.citations = [
            CitationResponse(
                number=citation_map[chunk.chunk_id],
                source_type=chunk.source_type,
                source_title=chunk.source_title,
                excerpt=chunk.content[:300] + "..." if len(chunk.content) > 300 else chunk.content,
                chunk_id=chunk.chunk_id,
            )
            for chunk in all_chunks
        ]
        
        return memo_content, citations
    
    async def _generate_memo_content(
        self,
        initiative: Project,
        section_chunks: dict[str, list[RetrievedChunk]],
        citation_map: dict,
    ) -> MemoContent:
        """Generate memo content using GPT"""
        # Build context from chunks
        context = self._build_context(section_chunks, citation_map)
        
        # Build initiative summary
        initiative_summary = f"""
Project: {initiative.title}
Sector: {initiative.sector}
Geography: {initiative.geography}
Target Population: {initiative.target_population}
Goal: {initiative.goal}
Budget: {initiative.budget_range or 'Not specified'}
Timeline: {initiative.timeline or 'Not specified'}
Constraints: {', '.join(initiative.constraints) if initiative.constraints else 'None specified'}
"""
        
        system_prompt = self._load_generation_prompt()
        
        response = await acompletion(
            self.user_id,
            self.db,
            role=ModelRole.GENERATION,
            complexity=Complexity.HEAVY,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": f"""Generate an investment memo for this initiative.

INITIATIVE DETAILS:
{initiative_summary}

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
                                "description": "2-3 paragraph executive summary of the initiative and recommendation"
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
        
        # Parse response
        tool_call = response.choices[0].message.tool_calls[0]
        memo_data = json.loads(tool_call.function.arguments)
        
        return MemoContent(
            title=f"Investment Memo: {initiative.title}",
            date=date.today().isoformat(),
            executive_summary=memo_data["executive_summary"],
            recommendation=memo_data["recommendation"],
            recommendation_rationale=memo_data["recommendation_rationale"],
            evidence_summary=memo_data["evidence_summary"],
            risks_and_assumptions=memo_data["risks_and_assumptions"],
            open_questions=memo_data.get("open_questions", []),
            citations=[],  # Will be added after
        )
    
    def _build_context(
        self,
        section_chunks: dict[str, list[RetrievedChunk]],
        citation_map: dict,
    ) -> str:
        """Build context string from retrieved chunks"""
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
    
    def _load_generation_prompt(self) -> str:
        """Load generation system prompt"""
        prompt_path = Path(__file__).resolve().parents[2] / get_domain_prompt_path("memo_generation.txt")
        if prompt_path.exists():
            return prompt_path.read_text(encoding="utf-8")
        return self._default_generation_prompt()
    
    def _default_generation_prompt(self) -> str:
        return """You are an expert analyst generating investment memos for development initiatives.

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
