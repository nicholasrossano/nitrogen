"""LLM-driven requirement extraction from parsed templates and cross-referencing
against project evidence / materials."""

from __future__ import annotations

import json
import logging
import uuid as _uuid_module
from dataclasses import dataclass, field
from uuid import UUID

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import get_settings
from app.services.template_parser import TemplateStructure, TemplateField
from app.services.rag import RAGService, RetrievedChunk
from app.models.project_material import ProjectMaterial

settings = get_settings()
logger = logging.getLogger(__name__)


# ── Data types ──────────────────────────────────────────────────────

@dataclass
class TemplateRequirement:
    id: str
    label: str
    description: str
    category: str           # section name the requirement belongs to
    field_type: str         # text | number | narrative | table_row | formula
    is_calculated: bool
    is_mandatory: bool
    source_location: str    # original location in the template
    matched_fields: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "description": self.description,
            "category": self.category,
            "field_type": self.field_type,
            "is_calculated": self.is_calculated,
            "is_mandatory": self.is_mandatory,
            "source_location": self.source_location,
            "matched_fields": self.matched_fields,
        }


@dataclass
class RequirementSource:
    source_type: str   # evidence | corpus | material | conversation
    source_id: str
    source_title: str
    quote: str
    similarity: float = 0.0

    def to_dict(self) -> dict:
        return {
            "source_type": self.source_type,
            "source_id": self.source_id,
            "source_title": self.source_title,
            "quote": self.quote,
            "similarity": self.similarity,
        }


@dataclass
class RequirementStatus:
    requirement: TemplateRequirement
    status: str         # supported | partially_supported | missing | needs_confirmation
    value: str | None = None
    sources: list[RequirementSource] = field(default_factory=list)
    confidence: float = 0.0

    def to_dict(self) -> dict:
        return {
            **self.requirement.to_dict(),
            "status": self.status,
            "value": self.value,
            "sources": [s.to_dict() for s in self.sources],
            "confidence": self.confidence,
        }


# ── Extraction schema for the LLM ──────────────────────────────────

_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "requirements": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "label": {"type": "string", "description": "Short human-readable label for this requirement"},
                    "description": {"type": "string", "description": "What information is needed and why"},
                    "category": {"type": "string", "description": "Section or group this belongs to"},
                    "field_type": {"type": "string", "enum": ["text", "number", "narrative", "table_row", "formula"]},
                    "is_calculated": {"type": "boolean"},
                    "is_mandatory": {"type": "boolean"},
                    "source_location": {"type": "string"},
                },
                "required": ["id", "label", "description", "category", "field_type", "is_calculated", "is_mandatory", "source_location"],
            },
        },
    },
    "required": ["requirements"],
}

_VALUE_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "matches": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "requirement_id": {"type": "string"},
                    "value": {"type": "string", "description": "The extracted value or answer"},
                    "confidence": {"type": "number", "description": "0.0 – 1.0 confidence in the match"},
                    "quote": {"type": "string", "description": "Direct quote from the source supporting this value"},
                },
                "required": ["requirement_id", "value", "confidence", "quote"],
            },
        },
    },
    "required": ["matches"],
}


class TemplateAnalysisService:
    """Orchestrates requirement extraction (via LLM) and cross-referencing
    against project evidence/materials."""

    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    # ── 1. Extract requirements ─────────────────────────────────────

    async def extract_requirements(
        self, structure: TemplateStructure, on_progress=None,
    ) -> list[TemplateRequirement]:
        """Send the parsed template to an LLM and get back a structured list
        of requirements."""

        if on_progress:
            await on_progress("Analyzing template structure...")

        struct_summary = json.dumps(structure.to_dict(), indent=2)

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a document analysis expert. Given a parsed template "
                    "structure (sections, fields, placeholders, formulas), identify "
                    "every distinct piece of information the template requires to be "
                    "completed. For spreadsheet formulas, mark them as calculated "
                    "(is_calculated=true) — they are outputs, not inputs. Focus on "
                    "real requirements, not formatting or boilerplate. Be thorough "
                    "but avoid duplicates. Respond with a JSON object."
                ),
            },
            {
                "role": "user",
                "content": f"Analyze this template and extract all requirements. Return a JSON object with a 'requirements' array:\n\n{struct_summary}",
            },
        ]

        resp = await self.client.chat.completions.create(
            model=settings.openai_orchestration_model,
            messages=messages,
            response_format={"type": "json_object"},
            temperature=0.1,
        )

        raw = resp.choices[0].message.content or "{}"
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.error("Failed to parse LLM extraction output")
            return self._requirements_from_structure(structure)

        # The LLM may nest the array under a different top-level key; try common ones
        raw_items = data.get("requirements") or data.get("items") or data.get("fields") or []
        # If the JSON root IS a list (shouldn't happen with json_object but guard anyway)
        if isinstance(data, list):
            raw_items = data

        reqs: list[TemplateRequirement] = []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            reqs.append(TemplateRequirement(
                id=item.get("id", "") or str(_uuid_module.uuid4())[:8],
                label=item.get("label", ""),
                description=item.get("description", ""),
                category=item.get("category", ""),
                field_type=item.get("field_type", "text"),
                is_calculated=bool(item.get("is_calculated", False)),
                is_mandatory=bool(item.get("is_mandatory", True)),
                source_location=item.get("source_location", ""),
            ))

        if not reqs:
            return self._requirements_from_structure(structure)

        return reqs

    def _requirements_from_structure(self, structure: TemplateStructure) -> list[TemplateRequirement]:
        """Fallback: build requirements directly from parsed fields."""
        reqs = []
        for section in structure.sections:
            for f in section.fields:
                reqs.append(TemplateRequirement(
                    id=f.id,
                    label=f.label,
                    description=f.description,
                    category=section.title,
                    field_type=f.field_type,
                    is_calculated=f.is_calculated,
                    is_mandatory=f.required,
                    source_location=f.location,
                ))
        return reqs

    # ── 2. Cross-reference against project materials ────────────────

    async def cross_reference_requirements(
        self,
        db: AsyncSession,
        initiative_id: UUID,
        requirements: list[TemplateRequirement],
        on_progress=None,
    ) -> list[RequirementStatus]:
        """For each requirement, search evidence/corpus/materials and attempt
        to find supporting values."""

        if on_progress:
            await on_progress("Scanning project materials for matching information...")

        rag = RAGService(db)

        mat_result = await db.execute(
            select(ProjectMaterial)
            .where(
                ProjectMaterial.initiative_id == initiative_id,
                ProjectMaterial.content_text.isnot(None),
            )
        )
        materials = mat_result.scalars().all()
        materials_text = "\n\n---\n\n".join(
            f"[{m.filename}]\n{m.content_text[:3000]}" for m in materials if m.content_text
        )

        input_reqs = [r for r in requirements if not r.is_calculated]
        calc_reqs = [r for r in requirements if r.is_calculated]

        statuses: list[RequirementStatus] = []

        if input_reqs:
            if on_progress:
                await on_progress(f"Matching {len(input_reqs)} input requirements against project data...")

            batch_queries = [r.label + ": " + r.description for r in input_reqs]
            all_chunks: list[RetrievedChunk] = []
            for query in batch_queries[:20]:
                try:
                    chunks = await rag.retrieve(
                        query=query,
                        initiative_id=initiative_id,
                        sources=["evidence", "corpus"],
                        evidence_top_k=2,
                        corpus_top_k=2,
                    )
                    all_chunks.extend(chunks)
                except Exception:
                    logger.warning("RAG retrieval failed for query: %s", query[:60], exc_info=True)

            context_text = "\n\n".join(
                f"[{c.source_title}]: {c.content[:600]}" for c in all_chunks
            )
            if materials_text:
                context_text += "\n\n--- Project Materials ---\n" + materials_text[:6000]

            statuses.extend(
                await self._match_requirements_to_context(input_reqs, context_text, all_chunks, materials)
            )

        for r in calc_reqs:
            statuses.append(RequirementStatus(
                requirement=r,
                status="needs_confirmation",
                value=None,
                confidence=0.0,
            ))

        return statuses

    async def _match_requirements_to_context(
        self,
        requirements: list[TemplateRequirement],
        context_text: str,
        chunks: list[RetrievedChunk],
        materials: list,
    ) -> list[RequirementStatus]:
        """Use the LLM to match requirements against the retrieved context."""

        req_list = json.dumps([r.to_dict() for r in requirements], indent=2)

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a data extraction expert. Given a list of template "
                    "requirements and a set of project documents/evidence, determine "
                    "which requirements can be answered from the available information. "
                    "For each requirement you can answer, provide the extracted value, "
                    "a confidence score (0-1), and a direct quote from the source. "
                    "Only include requirements you found answers for — omit any you "
                    "cannot answer. Respond with a JSON object."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Requirements:\n{req_list}\n\n"
                    f"Available project information:\n{context_text[:12000]}\n\n"
                    "Return a JSON object with a 'matches' array."
                ),
            },
        ]

        resp = await self.client.chat.completions.create(
            model=settings.openai_orchestration_model,
            messages=messages,
            response_format={"type": "json_object"},
            temperature=0.1,
        )

        raw = resp.choices[0].message.content or "{}"
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = {"matches": []}

        raw_matches = data.get("matches") or data.get("results") or data.get("requirements") or []
        if isinstance(data, list):
            raw_matches = data
        # Filter to only dict items
        raw_matches = [m for m in raw_matches if isinstance(m, dict)]

        matches_by_id: dict[str, dict] = {}
        for m in raw_matches:
            rid = m.get("requirement_id", "")
            if rid:
                matches_by_id[rid] = m

        chunk_map: dict[str, RetrievedChunk] = {}
        for c in chunks:
            for m in raw_matches:
                quote = m.get("quote", "")
                if quote and quote[:40] in c.content:
                    chunk_map[m.get("requirement_id", "")] = c
                    break

        statuses: list[RequirementStatus] = []
        for req in requirements:
            match = matches_by_id.get(req.id)
            if match and match.get("confidence", 0) >= 0.5:
                sources: list[RequirementSource] = []
                chunk = chunk_map.get(req.id)
                if chunk:
                    sources.append(RequirementSource(
                        source_type=chunk.source_type,
                        source_id=str(chunk.chunk_id),
                        source_title=chunk.source_title,
                        quote=match.get("quote", ""),
                        similarity=chunk.similarity,
                    ))
                statuses.append(RequirementStatus(
                    requirement=req,
                    status="supported" if match["confidence"] >= 0.75 else "partially_supported",
                    value=match.get("value"),
                    sources=sources,
                    confidence=match["confidence"],
                ))
            else:
                statuses.append(RequirementStatus(
                    requirement=req,
                    status="missing",
                    value=None,
                    confidence=0.0,
                ))

        return statuses
