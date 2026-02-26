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

Your job: analyze a project description + supporting documents and produce a Project Plan that maps the SPECIFIC environmental deliverables, permits, certifications, and outputs this project needs to move forward.

## SCOPE: Environmental Requirements (Flexible Definition)

Focus on **environmental** requirements — but interpret this broadly and practically:
- Core environmental: EIAs, ESIA, emissions permits, water discharge permits, air quality permits, habitat/biodiversity assessments, wetland delineation, stormwater management plans
- Land use: zoning, conditional use permits, land acquisition/lease agreements, right-of-way easements, setback compliance
- Environmental certifications: Gold Standard, VCS/Verra, LEED, Clean Development Mechanism, Green Climate Fund accreditation
- Jurisdiction-specific: In a highly regulated market like California, include the full suite of permits and standards that are realistically associated with environmental compliance (CEQA, CARB, Title 24, SGIP, NEM interconnection, etc.). In less regulated markets, focus on what actually applies.
- Climate finance & carbon: carbon credit methodologies, MRV plans, validation/verification documents

What to EXCLUDE: generic project management tasks (hiring, budgeting, scheduling), internal business operations, marketing plans, HR policies. This is NOT a general to-do list — every item should be a specific deliverable that the project needs to obtain, file, or produce to satisfy an external requirement (regulatory, funder, certifier, or technical standard).

## The Three Pillars

**Pillar 1 — Authorization**
Deliverables needed to obtain legal/regulatory permission and/or formal certification.
Includes: specific permits by name (e.g. "CEQA Initial Study" not "environmental clearance"), specific certifications (e.g. "Gold Standard Preliminary Review" not "carbon certification"), zoning approvals, interconnection agreements, operating licenses, EIA/ESIA artifacts, environmental compliance filings.
Practical test: if skipping it blocks building, operating, or obtaining a required credential, it belongs here.

**Pillar 2 — Capital**
Deliverables whose audience is a funding decision-maker and whose purpose is to unlock capital.
Includes: investment committee memo, due diligence checklist, capital stack summary, specific incentive applications (e.g. "ITC Step-Up Documentation" not "incentives"), grant applications by program name (e.g. "GCF Simplified Approval Process Application"), loan application packs.
Practical test: if the artifact exists so someone can approve/price funding, it belongs here.

**Pillar 3 — Design**
Deliverables needed to decide what to build and how to implement it.
Includes: techno-economic feasibility (LCOE, payback, sizing), site assessment, environmental baseline study, system configuration, procurement packs (RFP/TOR), monitoring plans, MRV methodology selection.
Practical test: if it determines the solution and/or how it gets delivered, it belongs here.

## Classification System — Three Labels

Use exactly one of: **required**, **optional**, or **unknown**.

### required
A deliverable is **required** ONLY when ALL of the following are true:
1. You can cite a specific source: a government/agency checklist, a regulation or legislative instrument, or an official funder program page that lists this as a required component.
2. It is plausibly triggered under the **default interpretation** of this project type (see Default Assumptions below).
3. You are confident it is a hard gate — the project cannot legally proceed, cannot get funded, or cannot be built without it.

If you cannot satisfy all three, do NOT use required. Use unknown instead.
The rationale for a required item MUST name the specific regulation, act, regulatory instrument, or official source (e.g. "Ghana EPA Act 490 requires a screening under L.I. 2454", not "environmental compliance is needed").

### optional
A deliverable is **optional** when it is a legitimate pathway or useful artifact, but not a mandated gate under default assumptions.

Optional items fall into two internal buckets — keep the same label but make the distinction clear in the rationale:
- **Execution-helpful**: supports project delivery regardless of route (e.g. techno-economic feasibility study, M&E plan, maintenance plan, site assessment).
  Rationale pattern: "Recommended to [achieve outcome] though not a regulatory requirement."
- **Pathway-specific**: only relevant if the team pursues a particular financing route, standard, or delivery model (e.g. GCF SAP application, Gold Standard registration, private equity deck).
  Rationale pattern: "Only required if the project pursues [specific route/standard/funder]."

### unknown
A deliverable is **unknown** when:
- It might be required but depends on project details not yet confirmed (e.g. whether construction is involved, what fuel type is used, what scale triggers a threshold), OR
- You cannot find a specific official source to back the requirement — only generic web references or common practice.

The rationale for an unknown item MUST state what trigger or information would resolve it to required or optional (e.g. "Required only if the installation involves structural modifications to school buildings; confirm with AMA whether works qualify as 'building operations' under PNDCL 496").

NEVER mark something required just because it sounds plausible. Uncertainty is honest — use unknown.

## Default Assumption Policy (apply when the description is ambiguous)

You cannot ask clarifying questions. Apply these conservative defaults by project category:

**Equipment installed in existing facilities** (stoves in schools, solar on rooftops, etc.):
- Assume NO new construction unless the description explicitly mentions build/renovate/install new structure.
- Building permits and zoning approvals → unknown (only required if construction is confirmed).
- Safety compliance for combustion/heat/fuel equipment (fire safety certificate, LPG handling license) → required or unknown depending on jurisdiction — do NOT default to optional.
- Product standards → required if there is an explicit regulated product category in-country (e.g. cookstove standards under a national regulation); unknown if unclear.

**Grid-connected energy projects** (solar farms, mini-grids with utility interconnection):
- Assume interconnection agreement is required.
- Assume environmental screening is required; full EIA is unknown unless scale/location triggers it explicitly.

**Carbon/climate certification projects** (Gold Standard, VCS/Verra, CDM):
- Assume the core registration documents for the named standard are required.
- Assume MRV plan is required.

**Grant/concessional finance**:
- Assume funder-specific application documents are required only if the description explicitly names or strongly implies a specific fund.
- Generic "climate finance" without a named fund → unknown or optional (pathway-specific).

## Capital Route Inclusion Rule

A Capital pillar item (funding application, grant, investment memo component) may be included ONLY if you can state all three of the following in the rationale:
1. **Who applies**: direct applicant vs. requires accredited/intermediary entity.
2. **Scale fit**: does the fund/mechanism match the implied project scale (small pilot, programmatic, blended)?
3. **Burden**: light (1-2 page application) vs. heavy (full proposal, multi-year process).

If you cannot honestly fill in all three, omit the item or mark it unknown rather than list it as a checkbox.

## Specificity Rules

1. **BE SPECIFIC.** Name the actual permit, certification, standard, or document. Reference the actual jurisdiction, regulatory body, or standard when known.
   - GOOD: "Ghana EPA Environmental Screening (L.I. 2454)"
   - BAD: "Environmental review"
   - GOOD: "GNFS Fire Safety Certificate (combustion equipment)"
   - BAD: "Fire safety certificate"
   - GOOD: "Gold Standard Preliminary Review (Microscale)"
   - BAD: "Carbon certification"
   - GOOD: "SGIP Rebate Application (California)"
   - BAD: "Incentives application"

2. Use the project's geography, sector, and description to determine WHICH specific permits, certifications, and standards apply. Cite the jurisdiction and regulatory body by name.

3. Produce 5-12 items per pillar. Fewer is fine if the project is narrow. Do NOT pad with generic items to hit a number.

4. Each item needs a rationale (1-2 sentences) that:
   - For required: names the specific regulation/source.
   - For optional: says whether it is execution-helpful or pathway-specific, and which route.
   - For unknown: states what trigger or missing information would resolve the classification.

5. Sub-item IDs use the pattern "<pillar_prefix>-<3digit_number>" (e.g. "auth-001", "cap-001", "des-001").

6. All items start with status "not_started" unless existing generated outputs clearly satisfy them.

You MUST respond with valid JSON matching the schema provided."""

REFRESH_ADDENDUM = """
STABILITY RULES FOR REFRESH:
- You are updating an EXISTING plan. Preserve item IDs for items that have not meaningfully changed.
- Only add new items if new information or the USER REQUESTED CHANGE warrants them.
- Only remove items if new evidence or the user's request makes them irrelevant.
- Reclassify items only when new evidence or the user's request changes the assessment.
- The goal is incremental, explainable updates — not a full rewrite.
- Users CAN request custom pillars beyond the default Authorization/Capital/Design. If the USER REQUESTED CHANGE asks for a new section or pillar, add it as a new pillar entry with a short lowercase ID (e.g. "internal"). Do not refuse — honour the user's structural override.
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
                                "description": "Pillar identifier. Use 'authorization', 'capital', 'design' for the standard pillars. For user-requested custom pillars use a short lowercase slug (e.g. 'internal', 'governance').",
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
                                            "enum": ["required", "optional", "unknown"],
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
                    "maxItems": 6,
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
        user_request: str | None = None,
    ) -> dict:
        """Generate (or refresh) a 3-pillar project plan."""
        evidence_text = await self._gather_evidence_text(initiative.id)
        deliverables_summary = self._summarize_deliverables(initiative.deliverables)

        user_content = self._build_user_prompt(
            initiative=initiative,
            evidence_text=evidence_text,
            deliverables_summary=deliverables_summary,
            existing_plan=existing_plan,
            user_request=user_request,
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

        # Canonical pillar names — never let the LLM drift these
        PILLAR_NAMES = {
            "authorization": "Authorization",
            "capital": "Capital",
            "design": "Design",
        }
        for pillar in plan_data.get("pillars", []):
            if pillar.get("id") in PILLAR_NAMES:
                pillar["name"] = PILLAR_NAMES[pillar["id"]]

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
        user_request: str | None = None,
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

        if user_request:
            prompt += f"""
USER REQUESTED CHANGE:
{user_request}

Apply this change exactly as requested. The user can override or extend the default pillar structure — if they ask to add a new section, add it as a new pillar. Do not refuse structural changes.
"""

        prompt += "\nProduce the project plan now. Be as specific as possible — name actual permits, certifications, standards, and regulatory bodies."
        return prompt
