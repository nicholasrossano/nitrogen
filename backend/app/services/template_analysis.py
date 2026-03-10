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
    parent_id: str | None = None    # id of parent requirement (for conditional fields)
    condition: str | None = None    # "yes" | "no" | "true" | "false" — when parent_id is set
    sub_fields: list[dict] = field(default_factory=list)  # column-derived attributes for tabular sections

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
            "parent_id": self.parent_id,
            "condition": self.condition,
            "sub_fields": self.sub_fields,
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
        "form_summary": {
            "type": "string",
            "description": "A 2-5 sentence summary of what this form/template is for, its overall structure, which sections contain user inputs vs calculated outputs or appendices, and any notable patterns.",
        },
        "requirements": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "label": {"type": "string", "description": "Short human-readable label for this requirement"},
                    "description": {"type": "string", "description": "What information is needed and why"},
                    "category": {"type": "string", "description": "For XLSX: use the exact sheet/tab name (e.g. 'General & Finance'). For DOCX: use the section heading."},
                    "field_type": {"type": "string", "enum": ["text", "number", "boolean", "yes_no", "date", "currency", "narrative", "formula"]},
                    "is_calculated": {"type": "boolean"},
                    "is_mandatory": {"type": "boolean"},
                    "source_location": {"type": "string"},
                    "parent_id": {"type": "string", "description": "ID of the parent yes/no or boolean field, if this is a conditional follow-up (e.g. 'If yes, describe...'). null for top-level fields."},
                    "condition": {"type": "string", "description": "The parent's answer that triggers this field: 'yes', 'no', 'true', or 'false'. null for top-level fields."},
                    "sub_fields": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "label": {"type": "string", "description": "Column header label (e.g. 'Attached with email?', 'Comments')"},
                                "field_type": {"type": "string", "enum": ["text", "number", "boolean", "yes_no", "date", "currency", "narrative"]},
                                "source_location": {"type": "string", "description": "Cell reference for this row+column intersection (e.g. 'Sheet1!C5')"},
                            },
                            "required": ["id", "label", "field_type", "source_location"],
                        },
                        "description": "Column-derived attributes for tabular sections. Each column header that repeats across rows becomes a sub_field (e.g. 'Yes/No', 'If Yes fill in', 'Date', 'Comments', 'Attached?'). The parent requirement's field_type must be 'text' when all inputs are in sub_fields. Omit for non-tabular requirements.",
                    },
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
    ) -> tuple[list[TemplateRequirement], str]:
        """Send the parsed template to an LLM and get back a structured list
        of requirements plus a form summary string."""

        if on_progress:
            await on_progress("Analyzing template structure...")

        is_xlsx = structure.file_type == "xlsx"

        if is_xlsx:
            system_prompt = (
                "You are a spreadsheet analysis expert. You will receive the "
                "raw content of an Excel workbook, serialized row-by-row. Each "
                "cell is separated by ' | '. Cells marked [EMPTY] have no value "
                "and are likely input fields that need to be filled in. Cells "
                "marked [FORMULA:...] contain spreadsheet formulas — these are "
                "calculated outputs, not inputs.\n\n"
                "Your job is to identify every distinct piece of information "
                "the spreadsheet needs a user to provide. For each requirement:\n"
                "- Use the EXACT cell text as the label — copy it VERBATIM from the "
                "  spreadsheet. NEVER paraphrase, shorten, summarize, or reword. "
                "  If the cell says 'Does the organization have consumer protection "
                "  training, monitoring mechanisms, and targets in place', the label "
                "  must be that exact string, NOT 'Consumer protection training'.\n"
                "- Set category to the EXACT sheet/tab name the requirement appears "
                "  in (e.g. 'General & Finance', 'Climate and ESG'). This is the "
                "  '=== Sheet: ... ===' header in the raw content\n"
                "- Determine the expected input type using these field_type values:\n"
                "  • 'boolean' — a checkbox (true/false, e.g. attached/not attached)\n"
                "  • 'yes_no' — a Yes or No answer\n"
                "  • 'number' — a numeric value (counts, quantities, percentages)\n"
                "  • 'currency' — a monetary amount (dollars, euros, etc.)\n"
                "  • 'date' — a date value\n"
                "  • 'text' — a short text string\n"
                "  • 'narrative' — a longer free-form paragraph or description\n"
                "  • 'formula' — a calculated cell (spreadsheet formula)\n"
                "- Mark formulas as is_calculated=true — they are outputs\n"
                "- Mark fields that appear mandatory vs optional\n"
                "- Include the cell reference (e.g. 'Sheet1!B5') as source_location\n\n"
                "IMPORTANT: Return requirements in the same order they appear in "
                "the spreadsheet, top-to-bottom, left-to-right. Preserve the "
                "logical flow of the template.\n\n"
                "Be thorough — capture every input field. Ignore purely decorative "
                "or structural cells (headers, labels, instructions).\n\n"

                "TABULAR SECTIONS (CRITICAL — read carefully):\n"
                "When a section has a header row with column labels (e.g. row has: "
                "item name | Yes/No | If Yes fill in | Comments | Date) and then "
                "multiple data rows below, EVERY column with [EMPTY] cells is a "
                "sub_field on each row requirement. Rules:\n"
                "- Create ONE requirement per data row\n"
                "- The requirement label = the row's EXACT text (verbatim, no rewording)\n"
                "- The requirement field_type = 'text' (it is just a label!)\n"
                "- NEVER set the requirement's field_type to 'yes_no' or 'boolean' "
                "when the Yes/No comes from a COLUMN HEADER — that Yes/No is a sub_field\n"
                "- ALL columns with input cells become sub_fields, each with its own "
                "id, label (= EXACT column header text, verbatim), field_type, and source_location\n"
                "- ABSOLUTE RULE: If a requirement has ANY sub_fields, its field_type "
                "MUST be 'text'. NEVER 'yes_no' or 'boolean' on a parent with sub_fields.\n\n"
                "EXAMPLE 1 (multi-column funding table):\n"
                "  Row 8: [header] | Yes/No | If Yes fill in: | Date | Round Size US$\n"
                "  Row 9: Was there an equity round? | [EMPTY] | [EMPTY] | [EMPTY] | [EMPTY]\n"
                "  Row 10: Was there a SAFE round? | [EMPTY] | [EMPTY] | [EMPTY] | [EMPTY]\n"
                "Produce (for row 9):\n"
                "  {\"label\": \"Was there an equity round?\", \"field_type\": \"text\", "
                "\"sub_fields\": [\n"
                "    {\"label\": \"Yes/No\", \"field_type\": \"yes_no\", \"source_location\": \"S!B9\"},\n"
                "    {\"label\": \"If Yes, please fill in\", \"field_type\": \"text\", \"source_location\": \"S!C9\"},\n"
                "    {\"label\": \"Date\", \"field_type\": \"date\", \"source_location\": \"S!D9\"},\n"
                "    {\"label\": \"Round Size US$\", \"field_type\": \"currency\", \"source_location\": \"S!E9\"}\n"
                "  ]}\n"
                "ALL 4 columns become sub_fields. field_type on parent is 'text', NOT 'yes_no'.\n\n"
                "EXAMPLE 2 (document checklist):\n"
                "  Row 3: [header] | Attached with email? | Comments\n"
                "  Row 4: MIS from Jan-25 | [EMPTY] | [EMPTY]\n"
                "Produce:\n"
                "  {\"label\": \"MIS from Jan-25\", \"field_type\": \"text\", \"sub_fields\": [\n"
                "    {\"label\": \"Attached with email?\", \"field_type\": \"yes_no\", \"source_location\": \"S!B4\"},\n"
                "    {\"label\": \"Comments\", \"field_type\": \"text\", \"source_location\": \"S!C4\"}\n"
                "  ]}\n\n"

                "HEADER-WITH-SUB-QUESTIONS (CRITICAL):\n"
                "When a header row poses a question or instruction (e.g. 'Does the "
                "Company have the following? If Yes, provide copy...') followed by "
                "a list of items that each have the same column inputs (like Yes/No), "
                "the header is NOT a requirement — it is context. Rules:\n"
                "- DO NOT create a requirement for the header row\n"
                "- Each item listed below the header IS a requirement\n"
                "- The column inputs (e.g. Yes/No) become sub_fields on each item\n"
                "- The header text can be used as part of the item's description for context\n\n"
                "EXAMPLE: If the spreadsheet has:\n"
                "  Row 10: Does the Company have the following? | Yes/No | If Yes, Provide evidence\n"
                "  Row 11: Copy of POSH policy | [EMPTY] | [EMPTY]\n"
                "  Row 12: Copy of ICC committee evidence | [EMPTY] | [EMPTY]\n"
                "  Row 13: Has training been conducted? | [EMPTY] | [EMPTY]\n"
                "Then produce THREE requirements (rows 11-13), NOT four. "
                "Do NOT create a requirement for row 10. Each requirement gets:\n"
                "  {\"label\": \"Copy of POSH policy\", \"field_type\": \"text\", "
                "\"sub_fields\": [\n"
                "    {\"label\": \"Yes/No\", \"field_type\": \"yes_no\", \"source_location\": \"Sheet!B11\"},\n"
                "    {\"label\": \"If Yes, Provide evidence\", \"field_type\": \"text\", \"source_location\": \"Sheet!C11\"}\n"
                "  ]}\n"
                "The same pattern applies to: 'Does the company have any of the "
                "following policies...', 'Has the company taken any of the listed "
                "strategic actions?', etc. — these are ALWAYS section headers, not "
                "standalone questions.\n"
                "DETECTION RULE: If a row's text ends with a colon, or contains "
                "'the following', 'any of the following', 'each of the following', "
                "'the below', or is immediately followed by 2+ indented/listed rows "
                "with the same column structure, treat it as a HEADER. DO NOT create "
                "a requirement for it.\n\n"

                "CONDITIONAL FIELDS (row-level): When a form has a yes/no question in "
                "one row and the NEXT ROW(S) are conditional follow-ups (e.g. 'If yes, "
                "describe...' / 'If no, commit to...'):\n"
                "- The parent question gets field_type 'yes_no' or 'boolean'\n"
                "- Each conditional follow-up sets parent_id to the parent's id\n"
                "- Each conditional follow-up sets condition to 'yes' or 'no'\n"
                "- Top-level (non-conditional) fields omit parent_id and condition\n"
                "NOTE: Do NOT confuse row-level conditionals with conditional COLUMNS. "
                "If 'If Yes, please fill in:' is a COLUMN HEADER that repeats across "
                "many rows, it is a sub_field (tabular pattern), not a conditional child.\n\n"

                "FORM SUMMARY: Include a 'form_summary' field in your JSON response "
                "(a string, 2-5 sentences). Describe what this form appears to be for, "
                "its overall structure (which sheets/tabs contain user input fields vs "
                "reference data, appendices, or auto-calculated sections), and any "
                "notable patterns (conditional logic, tabular checklists, etc.).\n\n"

                "Respond with a JSON object."
            )
            user_content = (
                "Analyze this spreadsheet and extract all requirements. "
                "Return a JSON object with 'form_summary' and 'requirements'.\n\n"
                "CRITICAL REMINDERS:\n"
                "1. Labels must be VERBATIM cell text — never paraphrase or shorten.\n"
                "2. For tabular sections, count ALL column headers with "
                "[EMPTY] cells — not just the first one. If a section has columns "
                "Yes/No | If Yes please fill in | Date | Round Size | Amount, "
                "then EACH row must have 5 sub_fields (one per column). "
                "The row requirement's field_type must be 'text'.\n\n"
                f"{structure.raw_text[:28000]}"
            )
        else:
            system_prompt = (
                "You are a document analysis expert. Given a parsed template "
                "structure (sections, fields, placeholders, formulas), identify "
                "every distinct piece of information the template requires to be "
                "completed. For each requirement, use one of these field_type "
                "values: 'boolean', 'yes_no', 'number', 'currency', 'date', "
                "'text', 'narrative', 'formula'. Mark formulas as calculated "
                "(is_calculated=true) — they are outputs, not inputs. "
                "Return requirements in document order. Focus on real "
                "requirements, not formatting or boilerplate. Be thorough "
                "but avoid duplicates.\n\n"
                "CONDITIONAL FIELDS: Many forms have yes/no questions followed by "
                "conditional sub-fields (e.g. 'If yes, describe the policy' / "
                "'If no, suggest a commitment'). For these:\n"
                "- The parent question should have field_type 'yes_no' or 'boolean'\n"
                "- Each conditional follow-up must set parent_id to the parent's id\n"
                "- Each conditional follow-up must set condition to 'yes' or 'no'\n"
                "- Top-level fields should omit parent_id and condition\n\n"
                "Respond with a JSON object."
            )
            user_content = (
                "Analyze this template and extract all requirements. "
                "Return a JSON object with a 'requirements' array:\n\n"
                + json.dumps(structure.to_dict(), indent=2)
            )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
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
            return self._requirements_from_structure(structure), ""

        form_summary = data.get("form_summary", "") or ""

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
                parent_id=item.get("parent_id") or None,
                condition=item.get("condition") or None,
                sub_fields=item.get("sub_fields") or [],
            ))

        if not reqs:
            logger.warning("LLM returned 0 requirements; falling back to structure-based extraction")
            return self._requirements_from_structure(structure), form_summary

        logger.info("LLM extraction returned %d requirements", len(reqs))
        return reqs, form_summary

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
