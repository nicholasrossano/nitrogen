"""Service for generating 3-pillar project plans using LLM analysis."""

import json
import logging
from datetime import datetime, timezone
from uuid import UUID

from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.evidence import EvidenceChunk, EvidenceDoc

settings = get_settings()
logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert environmental and development project analyst who produces hyper-specific, actionable project plans.

Your job: analyze a project description + supporting documents and produce a 3-pillar Project Plan that maps the SPECIFIC environmental deliverables, permits, certifications, and outputs this project needs to move forward.

## SCOPE: Environmental Requirements (Flexible Definition)

Focus on **environmental** requirements — but interpret this broadly and practically:
- Core environmental: EIAs, ESIA, emissions permits, water discharge permits, air quality permits, habitat/biodiversity assessments, wetland delineation, stormwater management plans
- Land use: zoning, conditional use permits, land acquisition/lease agreements, right-of-way easements, setback compliance
- Environmental certifications: Gold Standard, VCS/Verra, LEED, Clean Development Mechanism, Green Climate Fund accreditation
- Jurisdiction-specific: In a highly regulated market like California, include the full suite of permits and standards that are realistically associated with environmental compliance (CEQA, CARB, Title 24, SGIP, NEM interconnection, etc.). In less regulated markets, focus on what actually applies.
- Climate finance & carbon: carbon credit methodologies, MRV plans, validation/verification documents

What to EXCLUDE: generic project management tasks (hiring, budgeting, scheduling), internal business operations, marketing plans, HR policies. This is NOT a general to-do list — every item should be a specific deliverable that the project needs to obtain, file, or produce to satisfy an external requirement (regulatory, funder, certifier, or technical standard).

## The Three Pillars

**Pillar 1 — Authorization (includes Certification)**
Deliverables needed to obtain legal/regulatory permission and/or formal certification.
Includes: specific permits by name (e.g. "CEQA Initial Study" not "environmental clearance"), specific certifications (e.g. "Gold Standard Preliminary Review" not "carbon certification"), zoning approvals, interconnection agreements, operating licenses, EIA/ESIA artifacts, environmental compliance filings.
Practical test: if skipping it blocks building, operating, or obtaining a required credential, it belongs here.

**Pillar 2 — Capital**
Deliverables whose audience is a funding decision-maker and whose purpose is to unlock capital.
Includes: investment committee memo, due diligence checklist, capital stack summary, specific incentive applications (e.g. "ITC Step-Up Documentation" not "incentives"), grant applications by program name (e.g. "GCF Simplified Approval Process Application"), loan application packs.
Practical test: if the artifact exists so someone can approve/price funding, it belongs here.

**Pillar 3 — Design (includes Execution)**
Deliverables needed to decide what to build and how to implement it.
Includes: techno-economic feasibility (LCOE, payback, sizing), site assessment, environmental baseline study, system configuration, procurement packs (RFP/TOR), monitoring plans, MRV methodology selection.
Practical test: if it determines the solution and/or how it gets delivered, it belongs here.

## Classification Rules

- **Required**: objectively necessary to move forward. The project cannot legally proceed, cannot get funded, or cannot be built without this. Use this only when you are confident it is a hard gate.
- **Optional**: situational or recommended. Depends on geography, delivery model, funder requirements, or standard choice. Useful but the project could proceed without it.

## Critical Rules

1. **BE SPECIFIC.** Name the actual permit, certification, standard, or document. Reference the actual jurisdiction, regulatory body, or standard when known.
   - GOOD: "City of San Jose Building Permit (Title 24 Compliance)"
   - BAD: "Building permit"
   - GOOD: "SGIP Rebate Application (California)"
   - BAD: "Incentives application"
   - GOOD: "Gold Standard Preliminary Review (Microscale)"
   - BAD: "Carbon certification"
   - GOOD: "CEQA Initial Study / Mitigated Negative Declaration"
   - BAD: "Environmental review"

2. Use the project's geography, sector, and description to determine WHICH specific permits, certifications, and standards apply. If the project is in California, cite California-specific requirements. If it targets Gold Standard, cite the specific GS documents. If it's in Kenya, cite NEMA and ERA requirements.

3. Produce 5-12 items per pillar. Fewer is fine if the project is narrow.

4. Each item needs a short rationale (1-2 sentences) explaining why THIS project specifically needs it, grounded in what you know about the project's geography, technology, and sector.

5. Sub-item IDs use the pattern "<pillar_prefix>-<3digit_number>" (e.g. "auth-001", "cap-001", "des-001").

6. All items start with status "not_started" unless existing generated outputs clearly satisfy them.

You MUST respond with valid JSON matching the schema provided."""

REFRESH_ADDENDUM = """
STABILITY RULES FOR REFRESH:
- You are updating an EXISTING plan. Preserve item IDs for items that have not meaningfully changed.
- Only add new items if new information warrants them.
- Only remove items if the information clearly shows they are irrelevant.
- Reclassify items only when new evidence changes the assessment.
- The goal is incremental, explainable updates — not a full rewrite.
"""

PLAN_FUNCTION_SCHEMA = {
    "type": "function",
    "function": {
        "name": "produce_project_plan",
        "description": "Produce a structured 3-pillar project plan with specific, tangible items",
        "parameters": {
            "type": "object",
            "properties": {
                "pillars": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {
                                "type": "string",
                                "enum": ["authorization", "capital", "design"],
                            },
                            "name": {"type": "string"},
                            "summary": {
                                "type": "string",
                                "description": "1-2 sentence summary of what this pillar covers for this specific project",
                            },
                            "items": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "id": {
                                            "type": "string",
                                            "description": "Stable ID like auth-001, cap-001, des-001",
                                        },
                                        "title": {
                                            "type": "string",
                                            "description": "Specific deliverable name — cite actual permits, certifications, standards by name",
                                        },
                                        "classification": {
                                            "type": "string",
                                            "enum": ["required", "optional"],
                                        },
                                        "status": {
                                            "type": "string",
                                            "enum": ["not_started", "in_progress", "complete"],
                                        },
                                        "rationale": {
                                            "type": "string",
                                            "description": "1-2 sentences: why this project specifically needs this item",
                                        },
                                    },
                                    "required": [
                                        "id", "title", "classification", "status", "rationale",
                                    ],
                                },
                            },
                        },
                        "required": ["id", "name", "summary", "items"],
                    },
                    "minItems": 3,
                    "maxItems": 3,
                },
            },
            "required": ["pillars"],
        },
    },
}


class ProjectPlanService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.openai_orchestration_model

    async def generate(
        self,
        initiative,
        existing_plan: dict | None = None,
    ) -> dict:
        """Generate (or refresh) a 3-pillar project plan."""
        evidence_text = await self._gather_evidence_text(initiative.id)
        deliverables_summary = self._summarize_deliverables(initiative.deliverables)

        user_content = self._build_user_prompt(
            initiative=initiative,
            evidence_text=evidence_text,
            deliverables_summary=deliverables_summary,
            existing_plan=existing_plan,
        )

        system = SYSTEM_PROMPT
        if existing_plan:
            system += "\n\n" + REFRESH_ADDENDUM

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
            tools=[PLAN_FUNCTION_SCHEMA],
            tool_choice={"type": "function", "function": {"name": "produce_project_plan"}},
            temperature=0.4,
        )

        tool_call = response.choices[0].message.tool_calls[0]
        plan_data = json.loads(tool_call.function.arguments)

        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "pillars": plan_data["pillars"],
        }

    async def _gather_evidence_text(self, initiative_id: UUID) -> str:
        """Collect text from all uploaded evidence documents, truncated per doc."""
        MAX_CHARS_PER_DOC = 6000
        MAX_TOTAL_CHARS = 30000

        result = await self.db.execute(
            select(EvidenceDoc)
            .where(EvidenceDoc.initiative_id == initiative_id)
            .order_by(EvidenceDoc.created_at)
        )
        docs = result.scalars().all()

        if not docs:
            return "(No documents uploaded yet.)"

        parts: list[str] = []
        total = 0

        for doc in docs:
            chunk_result = await self.db.execute(
                select(EvidenceChunk.content)
                .where(EvidenceChunk.evidence_doc_id == doc.id)
                .order_by(EvidenceChunk.chunk_index)
            )
            chunks = chunk_result.scalars().all()
            doc_text = " ".join(chunks)

            if len(doc_text) > MAX_CHARS_PER_DOC:
                doc_text = doc_text[:MAX_CHARS_PER_DOC] + " [truncated]"

            header = f"\n--- Document: {doc.filename or 'Untitled'} ({doc.file_type or 'unknown'}) ---\n"
            entry = header + doc_text
            if total + len(entry) > MAX_TOTAL_CHARS:
                parts.append(header + doc_text[: MAX_TOTAL_CHARS - total] + " [truncated]")
                break
            parts.append(entry)
            total += len(entry)

        return "\n".join(parts)

    def _summarize_deliverables(self, deliverables: dict | None) -> str:
        if not deliverables:
            return "(No outputs generated yet.)"

        lines = []
        for tool_id, data in deliverables.items():
            title = data.get("title") or data.get("name") or tool_id
            output_type = data.get("output_type", "document")
            lines.append(f"- {title} ({output_type})")
        return "\n".join(lines)

    def _build_user_prompt(
        self,
        initiative,
        evidence_text: str,
        deliverables_summary: str,
        existing_plan: dict | None,
    ) -> str:
        desc = initiative.project_description or "(No description provided.)"
        project_type = initiative.project_type or "unclassified"
        geography = initiative.geography or "unspecified"
        title = initiative.title or "Untitled Project"

        prompt = f"""Analyze the following project and produce a 3-pillar Project Plan.

PROJECT: {title}
TYPE: {project_type}
GEOGRAPHY: {geography}

DESCRIPTION:
{desc}

UPLOADED DOCUMENTS:
{evidence_text}

EXISTING GENERATED OUTPUTS:
{deliverables_summary}
"""

        if existing_plan:
            prompt += f"""
EXISTING PLAN (for refresh — maintain stability):
{json.dumps(existing_plan, indent=2)}
"""

        prompt += "\nProduce the 3-pillar project plan now. Be as specific as possible — name actual permits, certifications, standards, and regulatory bodies."
        return prompt
