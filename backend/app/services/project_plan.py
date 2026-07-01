"""Service for generating 3-pillar project plans using LLM analysis."""

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.llm_invoke import acompletion
from app.core.model_catalog import Complexity, ModelRole
from app.models.evidence import EvidenceChunk, EvidenceDoc
from app.schemas.provenance import (
    Derivation,
    ItemProvenance,
    SourceAttribution,
    source_attribution_from_retrieved_fact,
)
from app.services.tiered_retrieval import TieredRetrievalService

settings = get_settings()
logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert sustainable development program designer who produces hyper-specific, actionable project plans.

Your job: analyze a project description + supporting documents and produce a Project Plan that maps the SPECIFIC deliverables and assessments this project needs to move from concept to implementation — covering regulatory approvals, environmental & social compliance, feasibility, funding strategy, stakeholder engagement, and technical design.

The plan includes both:
- **Deliverables**: external-facing outputs, submissions, approvals, and formal artifacts
- **Assessments**: internal calculations, models, screenings, and analyses that support one or more deliverables

## SCOPE: Sustainable Development Program Design

Think like a project developer preparing for DFI funding, investor due diligence, certification, or government approval. Cover every workstream that a credible project design document would address:

- **Regulatory & environmental compliance**: EIAs, ESIA, emissions permits, water discharge permits, air quality permits, habitat/biodiversity assessments, wetland delineation, stormwater management plans, zoning, land acquisition, right-of-way easements, setback compliance
- **Environmental certifications & carbon**: Gold Standard, VCS/Verra, LEED, CDM, GCF accreditation, carbon credit methodologies, MRV plans, validation/verification documents
- **Feasibility & technical design**: techno-economic analysis (LCOE, payback, sizing), resource assessment, site assessment, system configuration, engineering studies, procurement packs (RFP/TOR)
- **Funding strategy & investor readiness**: tailored to the project's likely funding route — DFI application packages for developing-country projects, tax equity/PPA documentation for US renewable energy, grant applications by program name, IC memos, due diligence checklists, capital stack summaries
- **Stakeholder & community engagement**: stakeholder mapping, community consultation plans, FPIC processes, social impact assessments, public hearings — include when the project's geography, scale, or funder requirements warrant it
- **Market & demand assessment**: offtake analysis, demand studies, bankability assessments — include when the project needs to demonstrate commercial viability to funders or investors
- **Environmental & social safeguards**: E&S frameworks (IFC PS, World Bank ESF, Equator Principles), resettlement plans, labor standards — include when DFI or lender requirements apply
- **Jurisdiction-specific**: In highly regulated markets, include the full suite of applicable permits and standards. In less regulated markets, focus on what actually applies.

What to EXCLUDE: generic project management tasks (hiring, scheduling, internal meetings), HR policies, internal business operations, marketing campaigns, generic "to-do" items. Every item should be a specific deliverable or assessment the project needs to satisfy an external requirement or demonstrate readiness.

## Item Types — Deliverable vs Assessment

Every item MUST have an `item_type` of either `"deliverable"` or `"assessment"`.

**Deliverable** — a formal output, submission, approval, or externally reviewed artifact. Something a regulator, funder, certifier, investor, utility, or government body would expect to receive, review, approve, or rely on directly.
Examples: CEQA Initial Study, Interconnection Application, Gold Standard Certification Package, Power Purchase Agreement, Grant Application, Investor Memo, EIA Certificate.

**Assessment** — an internal calculation, screening, model, or structured analysis that supports one or more deliverables. Assessments may be generated inside the product, uploaded, or created collaboratively. They are top-level plan items, but semantically distinct from deliverables.
Examples: PV production estimate, LCOE model, BAR-HAP Health & Exposure Benefit Assessment, interconnection feasibility assessment, site screening, regulatory pathway assessment, carbon finance viability assessment, E&S risk screening.

**How to decide**: Make it a Deliverable if it is required by a regulator/funder/certifier, is a formal submission, or an approval/license/permit/agreement. Make it an Assessment if it is an internal model, screening, or analytical dependency that informs decision-making or supports deliverables.

Special case: if a model or analysis is itself a formally reviewed artifact (e.g. a formal energy model submitted for certification review), treat it as a Deliverable.

## Assessment Placement Guidelines

Place assessments in the category they most directly support — NOT in a separate "assessments" bucket.
Examples:
- PV production estimate → Feasibility & Technical Design
- LCOE model → Funding & Investor Readiness
- Interconnection feasibility assessment → Regulatory & Permitting or Grid Interconnection
- E&S risk screening → Environmental & Social Safeguards
- Baseline scenario assessment → Carbon & MRV

## Supports / Depends On

Where relevant, include `supports` (list of item IDs this item feeds into) and `depends_on` (list of item IDs this item depends on). These are optional but encouraged for assessments that support multiple deliverables.
Example: an LCOE Model may support an Investor Memo, Incentive Eligibility Review, and PPA Negotiation.

## Default Pillars (when no approved categories are provided)

These are the default pillars. When the user has confirmed custom categories, use those instead.

**Pillar 1 — Authorization**
Deliverables needed to obtain legal/regulatory permission and/or formal certification.
Includes: specific permits by name (e.g. "CEQA Initial Study" not "environmental clearance"), specific certifications (e.g. "Gold Standard Preliminary Review" not "carbon certification"), zoning approvals, interconnection agreements, operating licenses, EIA/ESIA artifacts, environmental compliance filings.
Practical test: if skipping it blocks building, operating, or obtaining a required credential, it belongs here.

**Pillar 2 — Capital**
Deliverables whose audience is a funding decision-maker and whose purpose is to unlock capital.
Includes: investment committee memo, due diligence checklist, capital stack summary, specific incentive applications (e.g. "ITC Step-Up Documentation" not "incentives"), grant applications by program name (e.g. "GCF Simplified Approval Process Application"), loan application packs, market/demand studies needed for bankability.
Practical test: if the artifact exists so someone can approve/price funding, it belongs here.

**Pillar 3 — Design**
Deliverables needed to decide what to build and how to implement it.
Includes: techno-economic feasibility (LCOE, payback, sizing), site assessment, environmental baseline study, system configuration, procurement packs (RFP/TOR), monitoring plans, MRV methodology selection, stakeholder engagement plans.
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

6. All items start with status "not_started" unless uploaded documents or existing generated outputs clearly satisfy them.

## Document-Based Completion Detection

Carefully scan the UPLOADED DOCUMENTS section for evidence that work has already been completed.
When an uploaded document demonstrates that a plan item has been fulfilled, you MUST:
1. Set that item's `status` to "complete".
2. In the `rationale`, explain what evidence you found AND cite the source document by name
   (e.g. "Complete — the uploaded 'Ghana EPA Screening Report.pdf' contains the approved
   environmental screening form with EPA reference number, satisfying this requirement.").
3. Populate `evidence_basis` with the document filename(s) and a brief excerpt or description
   of the relevant content found in each.

Examples of what counts as evidence of completion:
- An uploaded permit, certificate, or approval letter → the corresponding plan item is complete.
- A feasibility study or assessment report → the corresponding assessment item is complete.
- A signed MOU, stakeholder agreement, or letter of support → the engagement item is complete.
- A completed application form or submission receipt → the submission item is complete.

Be conservative: only mark "complete" when the document clearly satisfies the requirement.
Partial evidence (e.g. a draft, an expired certificate) should leave status as "not_started"
but the rationale should note what was found and what remains.

## Phase Assignment

Every item MUST have a `phase` field and a `phase_order` field (integer, for ordering within a phase).

You must also provide a top-level `phases` array that defines the project's phases in chronological order. Adapt phase names to the project type:
- **Energy projects**: "Pre-Development", "Development & Permitting", "Financial Close", "Construction & Commissioning"
- **Carbon/climate projects**: "Feasibility & Design", "Registration & Validation", "Implementation", "Monitoring & Verification"
- **General/infrastructure**: "Scoping & Assessment", "Design & Approvals", "Procurement & Construction", "Operations & Compliance"

Use 3-5 phases. Phase IDs should be short lowercase slugs (e.g. "pre_dev", "permitting", "financial_close").

## Assessment Chronology

Assessments do NOT automatically belong only in the first phase. Typical pattern:
- Phase 1: screening and preliminary assessments
- Phase 2: formalized design, pathway, technical, environmental, and financing assessments
- Later phases: verification, commissioning, monitoring, reporting, and as-built confirmation

Many assessments begin early but some are refined in later phases; some only become relevant once the project reaches permitting, financing, validation, or deployment readiness.

## BAR-HAP Treatment

BAR-HAP and similar multi-component tools should be represented as separate assessment items rather than a single opaque acronym. For BAR-HAP, recommended items:
- Intervention Cost & Affordability Assessment
- Health & Exposure Benefit Assessment
- Environmental & Carbon Benefit Assessment
- (optional) Policy Intervention Scenario Assessment
Place each into the category it most directly supports.

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

CATEGORY_PROPOSAL_SYSTEM_PROMPT = """You are an expert sustainable development program designer.

Your job: given a project description and any uploaded documents, propose the most relevant HIGH-LEVEL CATEGORIES (pillars) for this project's needs map. Think like a project developer preparing a full program design — covering regulatory, environmental, financial, technical, and stakeholder workstreams as appropriate.

Each category will contain both Deliverables (formal outputs, submissions, approvals) and Assessments (internal models, screenings, analyses). Assessments should be placed in the category they most directly support — not in a separate "assessments" bucket.

## Rules
- Do NOT produce individual items, deliverables, or assessments — only the category structure.
- Read the project description carefully FIRST, then decide on categories. The description is the primary signal — not the project type label.
- Categories should cover the full scope of what the project needs to move forward: regulatory/permitting, funding/investor readiness, technical design, stakeholder engagement, E&S safeguards, market assessment — but only include categories that are genuinely relevant to THIS project.
- Match categories to the actual technology and workstreams. Examples by project type — use as a starting point only; always adapt names and summaries to the real project:
  - **Utility-scale solar farm**: Permitting & Environmental, Grid Interconnection, Capital & Incentives, Engineering & Procurement
  - **Offshore or onshore wind**: Marine/Land Permitting & Consenting, Grid Connection & Transmission, Capital & Offtake, Engineering & Procurement
  - **Mini-grid / energy access**: Regulatory & Licensing, Site & Load Assessment, Capital & Subsidy, EPC & Commissioning
  - **Clean cooking / cookstoves**: Regulatory & Product Certification, Health & Emissions Standards, Supply Chain & Distribution, Community Uptake & Finance
  - **Carbon / climate certification** (Gold Standard, Verra, CDM): Regulatory & Certification, Carbon Methodology & MRV, Funding & Finance, Implementation & Procurement
  - **Reforestation / land restoration**: Land Rights & Authorization, Carbon Standard Registration, Monitoring & Verification, Funding & Partnerships
  - **DFI-financed infrastructure**: Environmental & Social Safeguards, Permitting & Authorization, Capital & Financing, Stakeholder Engagement, Engineering & Procurement
- If the project does not closely match any example above, derive categories directly from the description — do NOT use a loosely similar example.
- Merge related workstreams into one category rather than creating many thin categories (e.g. market assessment items can live inside a Capital/Funding category; stakeholder engagement can live inside a Permitting category if it's part of the same process).
- **CRITICAL — summaries**: Every category summary MUST describe what that category covers for THIS specific project (its technology, geography, and context). Never write a summary that describes a different project type.
- Each category should represent a distinct workstream with at least 3–5 potential deliverables and/or assessments.
- Propose 3–6 categories. Prefer 4–5; use 6 only when the project genuinely has a distinct workstream that doesn't fit the others.
- Give each a short, clear name (2–4 words) and a 1–2 sentence summary of what it covers for THIS specific project.

You MUST respond with valid JSON matching the schema provided."""


PLAN_FUNCTION_SCHEMA = {
    "type": "function",
    "function": {
        "name": "produce_project_plan",
        "description": "Produce a structured project plan with categorized items and chronological phases",
        "parameters": {
            "type": "object",
            "properties": {
                "phases": {
                    "type": "array",
                    "description": "Chronological project phases, ordered from earliest to latest",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {
                                "type": "string",
                                "description": "Short lowercase slug (e.g. 'pre_dev', 'permitting', 'financial_close')",
                            },
                            "name": {
                                "type": "string",
                                "description": "Human-readable phase name (e.g. 'Pre-Development', 'Financial Close')",
                            },
                            "description": {
                                "type": "string",
                                "description": "1 sentence describing what happens in this phase for this project",
                            },
                        },
                        "required": ["id", "name"],
                    },
                    "minItems": 3,
                    "maxItems": 5,
                },
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
                                            "description": "Specific item name — cite actual permits, certifications, standards, assessments by name",
                                        },
                                        "item_type": {
                                            "type": "string",
                                            "enum": ["deliverable", "assessment"],
                                            "description": "Deliverable = formal output/submission/approval. Assessment = internal model/screening/analysis.",
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
                                        "phase": {
                                            "type": "string",
                                            "description": "Phase ID this item belongs to (must match one of the phase IDs in the phases array)",
                                        },
                                        "phase_order": {
                                            "type": "integer",
                                            "description": "Suggested order within the phase (lower = earlier)",
                                        },
                                        "source_indices": {
                                            "type": "array",
                                            "items": {"type": "integer"},
                                            "description": "Indices (1-based) of the WEB RESEARCH sources that support this item. Reference at least one source for required items.",
                                        },
                                        "evidence_basis": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "document_name": {
                                                        "type": "string",
                                                        "description": "Filename of the uploaded document (from UPLOADED DOCUMENTS section)",
                                                    },
                                                    "excerpt_or_description": {
                                                        "type": "string",
                                                        "description": "Brief description or excerpt of the relevant content found in this document",
                                                    },
                                                },
                                                "required": ["document_name", "excerpt_or_description"],
                                            },
                                            "description": "When marking an item as 'complete' based on uploaded documents, cite the document(s) and what was found. Also useful for noting partial evidence in not_started items.",
                                        },
                                        "supports": {
                                            "type": "array",
                                            "items": {"type": "string"},
                                            "description": "IDs of items this item feeds into / supports (optional, encouraged for assessments)",
                                        },
                                        "depends_on": {
                                            "type": "array",
                                            "items": {"type": "string"},
                                            "description": "IDs of items this item depends on (optional)",
                                        },
                                    },
                                    "required": [
                                        "id", "title", "item_type", "classification", "status", "rationale", "phase", "phase_order",
                                    ],
                                },
                            },
                        },
                        "required": ["id", "name", "summary", "items"],
                    },
                    "minItems": 2,
                    "maxItems": 7,
                },
            },
            "required": ["phases", "pillars"],
        },
    },
}


@dataclass
class WebResearchResult:
    """Web research formatted for the LLM prompt, plus indexed source metadata."""
    formatted_text: str
    sources: list = field(default_factory=list)  # list of RetrievedFact, 0-indexed


class ProjectPlanService:
    def __init__(self, db: AsyncSession, user_id: str | None = None):
        self.db = db
        self.user_id = user_id
        self.retrieval = TieredRetrievalService(db, user_id=self.user_id)

    async def generate(
        self,
        initiative,
        existing_plan: dict | None = None,
        user_request: str | None = None,
        approved_categories: list[dict] | None = None,
    ) -> dict:
        """Generate (or refresh) a project plan.

        When *approved_categories* is provided the LLM is instructed to produce
        items ONLY for those categories instead of the default three pillars.
        """
        evidence_text, web_result = await asyncio.gather(
            self._gather_evidence_text(initiative.id),
            self._gather_web_research(initiative, approved_categories=approved_categories),
        )
        deliverables_summary = self._summarize_deliverables(initiative.get_deliverables_dict())

        user_content = self._build_user_prompt(
            initiative=initiative,
            evidence_text=evidence_text,
            deliverables_summary=deliverables_summary,
            existing_plan=existing_plan,
            user_request=user_request,
            web_research=web_result.formatted_text,
            approved_categories=approved_categories,
        )

        system = SYSTEM_PROMPT
        if approved_categories:
            cats_desc = "\n".join(
                f"- **{c['name']}** (`{c['id']}`): {c.get('summary', '')}"
                for c in approved_categories
            )
            system += f"""

## APPROVED CATEGORIES (use these instead of the default three pillars)
The user has confirmed the following categories. Produce items ONLY for these pillars,
using the exact IDs and names below. Do NOT add or remove pillars.

{cats_desc}
"""
        if existing_plan:
            system += "\n\n" + REFRESH_ADDENDUM

        # Instruct the LLM to cite numbered web research sources
        if web_result.sources:
            system += """

## SOURCE CITATION
Web research sources above are numbered [S1], [S2], etc.
For each plan item, include a "source_indices" array listing the 1-based numbers
of the sources that support that item. Required items MUST cite at least one source.
"""

        response = await acompletion(
            self.user_id,
            self.db,
            role=ModelRole.ORCHESTRATION,
            complexity=Complexity.HEAVY,
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

        if approved_categories:
            # Carry the LLM-chosen icon from the confirmed categories onto each pillar
            icon_map = {c["id"]: c.get("icon", "") for c in approved_categories}
            for pillar in plan_data.get("pillars", []):
                icon = icon_map.get(pillar.get("id", ""))
                if icon:
                    pillar["icon"] = icon
        else:
            DEFAULT_PILLAR_NAMES = {
                "authorization": "Authorization",
                "capital": "Capital",
                "design": "Design",
            }
            DEFAULT_PILLAR_ICONS = {
                "authorization": "Shield",
                "capital": "Banknote",
                "design": "Compass",
            }
            for pillar in plan_data.get("pillars", []):
                pid = pillar.get("id", "")
                if pid in DEFAULT_PILLAR_NAMES:
                    pillar["name"] = DEFAULT_PILLAR_NAMES[pid]
                if pid in DEFAULT_PILLAR_ICONS:
                    pillar["icon"] = DEFAULT_PILLAR_ICONS[pid]

        # Attach provenance to each plan item
        self._attach_item_provenance(plan_data, web_result.sources)

        result = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "pillars": plan_data["pillars"],
        }
        if plan_data.get("phases"):
            result["phases"] = plan_data["phases"]
        return result

    @staticmethod
    def _attach_item_provenance(plan_data: dict, web_sources: list) -> None:
        """Convert LLM-emitted source_indices and evidence_basis into structured ItemProvenance."""
        for pillar in plan_data.get("pillars", []):
            for item in pillar.get("items", []):
                indices = item.pop("source_indices", None) or []
                evidence_basis = item.pop("evidence_basis", None) or []
                sources: list[dict] = []

                for idx in indices:
                    if 1 <= idx <= len(web_sources):
                        fact = web_sources[idx - 1]
                        sources.append(
                            source_attribution_from_retrieved_fact(fact).model_dump()
                        )

                for eb in evidence_basis:
                    sources.append(SourceAttribution(
                        source_type="evidence",
                        source_title=eb.get("document_name", "Uploaded document"),
                        excerpt=eb.get("excerpt_or_description"),
                    ).model_dump())

                has_evidence = any(s.get("source_type") == "evidence" for s in sources)
                has_web = any(s.get("source_type") != "evidence" for s in sources)
                if has_evidence:
                    derivation = Derivation.PROVIDED
                elif has_web:
                    derivation = Derivation.RESEARCHED
                else:
                    derivation = Derivation.INFERRED

                item["provenance"] = ItemProvenance(
                    derivation=derivation,
                    sources=[SourceAttribution(**s) for s in sources],
                    rationale=item.get("rationale", ""),
                ).model_dump()

    async def _gather_evidence_text(self, project_id: UUID) -> str:
        """Collect text from all uploaded evidence documents, truncated per doc."""
        MAX_CHARS_PER_DOC = 6000
        MAX_TOTAL_CHARS = 30000

        result = await self.db.execute(
            select(EvidenceDoc)
            .where(EvidenceDoc.project_id == project_id)
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

    async def _gather_web_research(
        self, initiative, approved_categories: list[dict] | None = None,
    ) -> WebResearchResult:
        """Run web searches for each pillar area to ground plan items in authoritative sources.

        Returns a WebResearchResult with numbered sources so the LLM can cite them
        via source_indices per plan item.
        """
        geography = initiative.geography or ""
        project_type = initiative.project_type or ""
        desc_snippet = (initiative.project_description or "")[:200]

        geo_tag = f" in {geography}" if geography else ""
        type_tag = f" {project_type}" if project_type else ""

        if approved_categories:
            queries = [
                f"{cat['name']}{type_tag} requirements deliverables{geo_tag}"
                for cat in approved_categories[:4]
            ]
        else:
            queries = [
                f"environmental permits regulatory approvals{type_tag} projects{geo_tag} official requirements",
                f"climate finance funding mechanisms grants{type_tag}{geo_tag} application requirements",
                f"environmental impact assessment feasibility study requirements{type_tag}{geo_tag}",
            ]
        if desc_snippet:
            queries.append(
                f"{desc_snippet}{geo_tag} permit certification requirements"
            )

        try:
            results = await asyncio.gather(
                *[self.retrieval.search_web(q, max_results=6, max_content_length=600) for q in queries]
            )

            pillar_labels = (
                [c["name"] for c in approved_categories] if approved_categories
                else ["Authorization", "Capital", "Design"]
            )

            # Build a flat, globally-numbered source list
            all_facts = []
            sections: list[str] = []
            for i, facts in enumerate(results):
                if not facts:
                    continue
                label = pillar_labels[i] if i < len(pillar_labels) else "General"
                lines = []
                for f in facts[:5]:
                    all_facts.append(f)
                    idx = len(all_facts)  # 1-based for the LLM
                    url_ref = f" ({f.source_url})" if f.source_url else ""
                    lines.append(f"- [S{idx}] [{f.source_title}{url_ref}]: {f.content[:500]}")
                sections.append(f"### {label} Research\n" + "\n".join(lines))

            if not sections:
                return WebResearchResult(
                    formatted_text="(No web research results retrieved.)",
                    sources=[],
                )

            return WebResearchResult(
                formatted_text="\n\n".join(sections),
                sources=all_facts,
            )

        except Exception as exc:
            logger.warning("Web research for plan generation failed: %s", exc)
            return WebResearchResult(
                formatted_text="(Web research unavailable.)",
                sources=[],
            )

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
        web_research: str = "",
        approved_categories: list[dict] | None = None,
    ) -> str:
        desc = initiative.project_description or "(No description provided.)"
        project_type = initiative.project_type or "unclassified"
        geography = initiative.geography or "unspecified"
        title = initiative.title or "Untitled Project"

        n_pillars = len(approved_categories) if approved_categories else 3
        prompt = f"""Analyze the following project and produce a {n_pillars}-pillar Project Plan.

PROJECT: {title}
TYPE: {project_type}
GEOGRAPHY: {geography}

DESCRIPTION:
{desc}

UPLOADED DOCUMENTS:
{evidence_text}

EXISTING GENERATED OUTPUTS:
{deliverables_summary}

WEB RESEARCH (authoritative sources retrieved from the web — use these to ground
item titles, classifications, and rationales; cite specific regulations, agencies,
and standards found here):
{web_research or "(No web research available.)"}
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
