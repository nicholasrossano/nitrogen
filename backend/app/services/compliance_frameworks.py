"""Static framework definitions for compliance pre-check.

Defines requirement trees, routing signals, and metadata for the six
supported framework families:
  1. IFC Performance Standards
  2. World Bank ESF / ESS
  3. Equator Principles EP4
  4. Verra VCS
  5. Gold Standard
  6. ASTM Phase I / AAI Readiness
"""

from __future__ import annotations

from dataclasses import dataclass, field


# ── Core data types ──────────────────────────────────────────────────


@dataclass
class FrameworkRequirement:
    """A single evaluable requirement within a framework."""
    id: str
    section: str
    name: str
    description: str
    conditional_on: list[str] = field(default_factory=list)
    evidence_queries: list[str] = field(default_factory=list)
    is_always_active: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "section": self.section,
            "name": self.name,
            "description": self.description,
            "conditional_on": self.conditional_on,
            "evidence_queries": self.evidence_queries,
            "is_always_active": self.is_always_active,
        }


@dataclass
class FrameworkMeta:
    """Top-level metadata for a framework."""
    id: str
    family: str
    name: str
    description: str

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "family": self.family,
            "name": self.name,
            "description": self.description,
        }


# ── Routing signals ──────────────────────────────────────────────────

ROUTING_SIGNALS: dict[str, list[str]] = {
    "ifc_ps": [
        "IFC financing", "DFI lending", "private sector development finance",
        "performance standards", "Category A project", "Category B project",
        "emerging market infrastructure", "project finance",
    ],
    "world_bank_esf": [
        "World Bank", "sovereign lending", "government borrower",
        "environmental and social framework", "ESS", "investment project financing",
        "IBRD", "IDA", "development policy financing",
    ],
    "equator_principles": [
        "Equator Principles", "EP4", "commercial bank project finance",
        "project finance advisory", "bridge loan", "export credit",
    ],
    "verra_vcs": [
        "Verra", "VCS", "verified carbon standard", "carbon credits",
        "voluntary carbon market", "emission reductions", "carbon offset",
        "REDD+", "afforestation", "reforestation",
    ],
    "gold_standard": [
        "Gold Standard", "GS4GG", "carbon plus SDG", "sustainable development goals",
        "clean cookstove", "renewable energy credits", "community benefit",
    ],
    "astm_phase1": [
        "ASTM", "Phase I", "Phase II", "environmental site assessment",
        "AAI", "all appropriate inquiries", "CERCLA", "brownfield",
        "recognized environmental condition", "REC", "due diligence site",
        "U.S. property transaction", "real estate environmental",
    ],
}


# ── Framework metadata ───────────────────────────────────────────────

FRAMEWORK_FAMILIES: dict[str, FrameworkMeta] = {
    "ifc_ps": FrameworkMeta(
        id="ifc_ps",
        family="lender_dfi",
        name="IFC Performance Standards",
        description="International Finance Corporation Performance Standards on Environmental and Social Sustainability.",
    ),
    "world_bank_esf": FrameworkMeta(
        id="world_bank_esf",
        family="lender_dfi",
        name="World Bank ESF / ESS",
        description="World Bank Environmental and Social Framework and associated Environmental and Social Standards.",
    ),
    "equator_principles": FrameworkMeta(
        id="equator_principles",
        family="lender_dfi",
        name="Equator Principles EP4",
        description="Equator Principles IV — risk management framework for financial institutions in project finance.",
    ),
    "verra_vcs": FrameworkMeta(
        id="verra_vcs",
        family="carbon_standard",
        name="Verra VCS",
        description="Verified Carbon Standard for voluntary carbon market project certification.",
    ),
    "gold_standard": FrameworkMeta(
        id="gold_standard",
        family="carbon_standard",
        name="Gold Standard",
        description="Gold Standard for the Global Goals — carbon and sustainable development certification.",
    ),
    "astm_phase1": FrameworkMeta(
        id="astm_phase1",
        family="site_diligence",
        name="ASTM Phase I / AAI Readiness",
        description="ASTM E1527 Phase I Environmental Site Assessment and All Appropriate Inquiries readiness.",
    ),
}

FAMILY_LABELS: dict[str, str] = {
    "lender_dfi": "Lender / DFI E&S",
    "carbon_standard": "Carbon Standard",
    "site_diligence": "Site Diligence",
}


# ── Requirement trees ────────────────────────────────────────────────

REQUIREMENT_TREES: dict[str, list[FrameworkRequirement]] = {
    # ----------------------------------------------------------------
    # IFC Performance Standards
    # ----------------------------------------------------------------
    "ifc_ps": [
        FrameworkRequirement(
            id="ps1_assessment",
            section="PS1 - Assessment and Management of E&S Risks",
            name="Environmental and Social Assessment",
            description="Has an environmental and social impact assessment (ESIA) been conducted or planned?",
            is_always_active=True,
            evidence_queries=["environmental and social impact assessment", "ESIA report"],
        ),
        FrameworkRequirement(
            id="ps1_esms",
            section="PS1 - Assessment and Management of E&S Risks",
            name="Environmental and Social Management System",
            description="Is an ESMS established with policy, procedures, organizational capacity, and monitoring?",
            is_always_active=True,
            evidence_queries=["environmental and social management system", "ESMS policy"],
        ),
        FrameworkRequirement(
            id="ps1_stakeholder",
            section="PS1 - Assessment and Management of E&S Risks",
            name="Stakeholder Engagement",
            description="Is there a stakeholder engagement plan with identified and engaged affected communities?",
            is_always_active=True,
            evidence_queries=["stakeholder engagement plan", "community consultation"],
        ),
        FrameworkRequirement(
            id="ps1_grievance",
            section="PS1 - Assessment and Management of E&S Risks",
            name="Grievance Mechanism",
            description="Is a grievance mechanism established for affected communities?",
            is_always_active=True,
            evidence_queries=["grievance mechanism", "complaint resolution procedure"],
        ),
        FrameworkRequirement(
            id="ps1_escp",
            section="PS1 - Assessment and Management of E&S Risks",
            name="Environmental and Social Commitment Plan",
            description="Is an ESCP in place defining mitigation measures, timelines, and responsible parties?",
            is_always_active=True,
            evidence_queries=["environmental and social commitment plan", "ESCP", "mitigation timeline"],
        ),
        FrameworkRequirement(
            id="ps1_disclosure",
            section="PS1 - Assessment and Management of E&S Risks",
            name="Information Disclosure",
            description="Has project E&S information been disclosed to affected communities in an accessible format?",
            is_always_active=True,
            evidence_queries=["information disclosure", "public disclosure", "E&S documents accessible"],
        ),
        FrameworkRequirement(
            id="ps2_working_conditions",
            section="PS2 - Labor and Working Conditions",
            name="Working Conditions and Terms of Employment",
            description="Are working conditions, terms of employment, and worker rights documented and communicated?",
            is_always_active=True,
            evidence_queries=["working conditions", "terms of employment", "labor policy", "worker rights"],
        ),
        FrameworkRequirement(
            id="ps2_nondiscrimination",
            section="PS2 - Labor and Working Conditions",
            name="Non-Discrimination and Equal Opportunity",
            description="Are non-discrimination policies in place covering hiring, terms, and treatment of workers?",
            is_always_active=True,
            evidence_queries=["non-discrimination", "equal opportunity", "anti-harassment policy"],
        ),
        FrameworkRequirement(
            id="ps2_ohs",
            section="PS2 - Labor and Working Conditions",
            name="Occupational Health and Safety",
            description="Are OHS measures documented with hazard identification, PPE, and incident reporting?",
            is_always_active=True,
            evidence_queries=["occupational health and safety", "OHS", "workplace safety", "PPE"],
        ),
        FrameworkRequirement(
            id="ps2_supply_chain",
            section="PS2 - Labor and Working Conditions",
            name="Supply Chain Labor Risk",
            description="Has supply chain labor risk been assessed, including child labor and forced labor?",
            conditional_on=["supply_chain_risk"],
            evidence_queries=["supply chain labor", "child labor", "forced labor", "supply chain audit"],
        ),
        FrameworkRequirement(
            id="ps3_pollution_prevention",
            section="PS3 - Resource Efficiency and Pollution Prevention",
            name="Pollution Prevention and Resource Efficiency",
            description="Are pollution prevention measures, waste management, and resource efficiency plans in place?",
            is_always_active=True,
            evidence_queries=["pollution prevention plan", "waste management", "resource efficiency"],
        ),
        FrameworkRequirement(
            id="ps3_ghg_emissions",
            section="PS3 - Resource Efficiency and Pollution Prevention",
            name="GHG Emissions Management",
            description="Are GHG emissions quantified and is a reduction/mitigation plan in place?",
            conditional_on=["significant_ghg"],
            evidence_queries=["GHG emissions", "greenhouse gas quantification", "carbon footprint"],
        ),
        FrameworkRequirement(
            id="ps4_community",
            section="PS4 - Community Health, Safety, and Security",
            name="Community Health and Safety",
            description="Are community health and safety risks assessed and mitigation measures planned?",
            is_always_active=True,
            evidence_queries=["community health and safety", "emergency preparedness"],
        ),
        FrameworkRequirement(
            id="ps5_resettlement",
            section="PS5 - Land Acquisition and Involuntary Resettlement",
            name="Land Acquisition and Resettlement",
            description="Does the project involve land acquisition, physical or economic displacement?",
            conditional_on=["land_acquisition"],
            evidence_queries=["resettlement action plan", "land acquisition", "livelihood restoration"],
        ),
        FrameworkRequirement(
            id="ps6_biodiversity",
            section="PS6 - Biodiversity Conservation",
            name="Biodiversity Conservation",
            description="Does the project affect critical habitats, protected areas, or natural ecosystems?",
            conditional_on=["biodiversity"],
            evidence_queries=["biodiversity assessment", "habitat impact", "protected area"],
        ),
        FrameworkRequirement(
            id="ps7_indigenous",
            section="PS7 - Indigenous Peoples",
            name="Indigenous Peoples",
            description="Does the project affect Indigenous Peoples or their lands, resources, or cultural heritage?",
            conditional_on=["indigenous_peoples"],
            evidence_queries=["indigenous peoples plan", "FPIC", "free prior and informed consent"],
        ),
        FrameworkRequirement(
            id="ps8_cultural",
            section="PS8 - Cultural Heritage",
            name="Cultural Heritage",
            description="Does the project affect tangible or intangible cultural heritage?",
            conditional_on=["cultural_heritage"],
            evidence_queries=["cultural heritage assessment", "chance find procedure", "archaeological"],
        ),
    ],

    # ----------------------------------------------------------------
    # World Bank ESF / ESS
    # ----------------------------------------------------------------
    "world_bank_esf": [
        FrameworkRequirement(
            id="ess1_assessment",
            section="ESS1 - Assessment and Management of E&S Risks",
            name="E&S Risk Assessment",
            description="Has an environmental and social assessment proportionate to risk been completed?",
            is_always_active=True,
            evidence_queries=["environmental and social assessment", "E&S risk assessment"],
        ),
        FrameworkRequirement(
            id="ess1_escp",
            section="ESS1 - Assessment and Management of E&S Risks",
            name="Environmental and Social Commitment Plan (ESCP)",
            description="Has an ESCP been prepared and agreed between borrower and the World Bank?",
            is_always_active=True,
            evidence_queries=["environmental and social commitment plan", "ESCP", "borrower commitment"],
        ),
        FrameworkRequirement(
            id="ess1_management",
            section="ESS1 - Assessment and Management of E&S Risks",
            name="E&S Management Framework",
            description="Is an environmental and social management framework or plan in place?",
            is_always_active=True,
            evidence_queries=["ESMF", "environmental and social management plan"],
        ),
        FrameworkRequirement(
            id="ess2_labor",
            section="ESS2 - Labor and Working Conditions",
            name="Labor Management Procedures",
            description="Are labor management procedures documented covering worker terms, OHS, and grievance?",
            conditional_on=["risk_moderate", "risk_substantial", "risk_high"],
            evidence_queries=["labor management procedures", "worker OHS", "labor grievance mechanism"],
        ),
        FrameworkRequirement(
            id="ess3_resource",
            section="ESS3 - Resource Efficiency and Pollution Prevention",
            name="Resource Efficiency and Pollution Prevention",
            description="Are measures for resource efficiency, pollution prevention, and waste management in place?",
            conditional_on=["risk_moderate", "risk_substantial", "risk_high"],
            evidence_queries=["resource efficiency", "pollution prevention", "GHG emissions"],
        ),
        FrameworkRequirement(
            id="ess4_community",
            section="ESS4 - Community Health and Safety",
            name="Community Health and Safety",
            description="Are community health and safety risks assessed with planned mitigation?",
            conditional_on=["risk_moderate", "risk_substantial", "risk_high"],
            evidence_queries=["community health safety", "security personnel", "emergency response"],
        ),
        FrameworkRequirement(
            id="ess5_resettlement",
            section="ESS5 - Land Acquisition and Involuntary Resettlement",
            name="Land Acquisition and Resettlement",
            description="Does the project involve land acquisition, restrictions on land use, or involuntary resettlement?",
            conditional_on=["land_acquisition"],
            evidence_queries=["resettlement plan", "livelihood restoration framework", "land acquisition compensation"],
        ),
        FrameworkRequirement(
            id="ess6_biodiversity",
            section="ESS6 - Biodiversity Conservation",
            name="Biodiversity Conservation and Sustainable Management",
            description="Does the project impact biodiversity, natural habitats, or living natural resources?",
            conditional_on=["biodiversity"],
            evidence_queries=["biodiversity management plan", "habitat offset", "critical habitat assessment"],
        ),
        FrameworkRequirement(
            id="ess7_indigenous",
            section="ESS7 - Indigenous Peoples",
            name="Indigenous Peoples / Sub-Saharan African Historically Underserved Communities",
            description="Does the project affect Indigenous Peoples or historically underserved traditional communities?",
            conditional_on=["indigenous_peoples"],
            evidence_queries=["indigenous peoples planning framework", "FPIC", "culturally appropriate consultation"],
        ),
        FrameworkRequirement(
            id="ess8_cultural",
            section="ESS8 - Cultural Heritage",
            name="Cultural Heritage",
            description="Does the project affect tangible or intangible cultural heritage?",
            conditional_on=["cultural_heritage"],
            evidence_queries=["cultural heritage management plan", "chance find", "archaeological survey"],
        ),
        FrameworkRequirement(
            id="ess9_fi",
            section="ESS9 - Financial Intermediaries",
            name="Financial Intermediary E&S Requirements",
            description="Does the project involve lending through financial intermediaries requiring their own E&S management?",
            conditional_on=["financial_intermediary"],
            evidence_queries=["financial intermediary ESMS", "FI E&S requirements", "sub-project screening"],
        ),
        FrameworkRequirement(
            id="ess10_stakeholder",
            section="ESS10 - Stakeholder Engagement and Information Disclosure",
            name="Stakeholder Engagement Plan",
            description="Has a stakeholder engagement plan (SEP) been prepared with disclosure and consultation provisions?",
            is_always_active=True,
            evidence_queries=["stakeholder engagement plan", "SEP", "information disclosure"],
        ),
    ],

    # ----------------------------------------------------------------
    # Equator Principles EP4
    # ----------------------------------------------------------------
    "equator_principles": [
        FrameworkRequirement(
            id="ep_categorization",
            section="Principle 1 - Review and Categorization",
            name="Project Categorization",
            description="Has the project been categorized (A, B, or C) based on E&S risk magnitude?",
            is_always_active=True,
            evidence_queries=["project categorization", "Category A B C", "E&S risk classification"],
        ),
        FrameworkRequirement(
            id="ep_assessment",
            section="Principle 2 - E&S Assessment",
            name="E&S Assessment",
            description="Has an environmental and social assessment proportionate to project risk been conducted?",
            is_always_active=True,
            evidence_queries=["environmental and social assessment", "ESIA", "impact assessment"],
        ),
        FrameworkRequirement(
            id="ep_standards",
            section="Principle 3 - Applicable E&S Standards",
            name="Applicable Standards Compliance",
            description="Does the project identify and plan to comply with applicable E&S standards (IFC PS or equivalent)?",
            is_always_active=True,
            evidence_queries=["IFC performance standards compliance", "applicable E&S standards", "host country law"],
        ),
        FrameworkRequirement(
            id="ep_designated_country",
            section="Principle 3 - Applicable E&S Standards",
            name="Designated Country Determination",
            description="Is the project in an EP Designated Country? Determines whether IFC PS or host country law applies.",
            conditional_on=["designated_country"],
            evidence_queries=["designated country", "OECD high-income", "host country equivalence"],
        ),
        FrameworkRequirement(
            id="ep_esms_ap",
            section="Principle 4 - E&S Management System and Action Plan",
            name="ESMS and E&S Action Plan",
            description="Is an ESMS in place with a corrective action plan addressing assessment gaps?",
            is_always_active=True,
            evidence_queries=["ESMS", "environmental and social action plan", "ESAP"],
        ),
        FrameworkRequirement(
            id="ep_stakeholder",
            section="Principle 5 - Stakeholder Engagement",
            name="Stakeholder Engagement",
            description="Is there an ongoing stakeholder engagement process with affected communities?",
            is_always_active=True,
            evidence_queries=["stakeholder engagement", "community consultation", "informed consultation"],
        ),
        FrameworkRequirement(
            id="ep_grievance",
            section="Principle 6 - Grievance Mechanism",
            name="Grievance Mechanism",
            description="Is a project-level grievance mechanism accessible to affected communities?",
            is_always_active=True,
            evidence_queries=["grievance mechanism", "complaints process"],
        ),
        FrameworkRequirement(
            id="ep_independent_review",
            section="Principle 7 - Independent Review",
            name="Independent Review Readiness",
            description="Is the project prepared for independent E&S review? Required for Cat A, recommended for Cat B.",
            conditional_on=["ep_category_a", "ep_category_b"],
            evidence_queries=["independent review", "E&S consultant review", "lender's E&S advisor"],
        ),
        FrameworkRequirement(
            id="ep_climate",
            section="Principle 7 - Independent Review",
            name="Climate Change Risk Assessment",
            description="Has a climate change risk assessment or alternatives analysis been conducted?",
            conditional_on=["significant_ghg", "climate_risk"],
            evidence_queries=["climate change risk assessment", "GHG alternatives analysis", "climate transition risk"],
        ),
        FrameworkRequirement(
            id="ep_human_rights",
            section="Principle 7 - Independent Review",
            name="Human Rights Due Diligence",
            description="Has human rights due diligence been conducted for conflict-affected or high-risk contexts?",
            conditional_on=["conflict_affected"],
            evidence_queries=["human rights due diligence", "conflict risk", "human rights impact assessment"],
        ),
        FrameworkRequirement(
            id="ep_covenants",
            section="Principle 8 - Covenants",
            name="Financial Covenant Readiness",
            description="Are E&S covenants prepared for inclusion in financial documentation?",
            is_always_active=True,
            evidence_queries=["E&S covenants", "loan agreement E&S", "compliance covenants"],
        ),
        FrameworkRequirement(
            id="ep_monitoring",
            section="Principle 9 - Independent Monitoring and Reporting",
            name="Independent Monitoring and Reporting",
            description="Is independent monitoring of E&S compliance arranged? Required for Cat A.",
            conditional_on=["ep_category_a"],
            evidence_queries=["independent monitoring", "E&S monitoring report", "annual compliance report"],
        ),
        FrameworkRequirement(
            id="ep_reporting",
            section="Principle 10 - Reporting and Transparency",
            name="Reporting and Transparency",
            description="Is the EPFI committed to transparent reporting on EP implementation?",
            is_always_active=True,
            evidence_queries=["EP reporting", "transparency", "annual report EP implementation"],
        ),
    ],

    # ----------------------------------------------------------------
    # Verra VCS
    # ----------------------------------------------------------------
    "verra_vcs": [
        FrameworkRequirement(
            id="vcs_boundary",
            section="Project Description",
            name="Project Boundary",
            description="Is the project boundary clearly defined including geographic, temporal, and GHG source/sink scope?",
            is_always_active=True,
            evidence_queries=["project boundary definition", "geographic scope", "GHG sources sinks reservoirs"],
        ),
        FrameworkRequirement(
            id="vcs_methodology",
            section="Methodology",
            name="Methodology Selection",
            description="Has an approved VCS methodology been identified and applied?",
            is_always_active=True,
            evidence_queries=["VCS methodology", "approved methodology", "methodology applicability"],
        ),
        FrameworkRequirement(
            id="vcs_baseline",
            section="Baseline",
            name="Baseline Scenario and Emissions",
            description="Has a credible baseline scenario been established with quantified baseline emissions?",
            is_always_active=True,
            evidence_queries=["baseline scenario", "baseline emissions", "counterfactual scenario"],
        ),
        FrameworkRequirement(
            id="vcs_additionality",
            section="Additionality",
            name="Additionality Demonstration",
            description="Has additionality been demonstrated using an approved tool or methodology requirement?",
            is_always_active=True,
            evidence_queries=["additionality test", "barrier analysis", "investment analysis", "common practice"],
        ),
        FrameworkRequirement(
            id="vcs_quantification",
            section="Quantification",
            name="Emission Reduction Quantification",
            description="Are emission reductions/removals quantified per the selected methodology with conservative assumptions?",
            is_always_active=True,
            evidence_queries=["emission reduction quantification", "ERR calculation", "conservative estimate"],
        ),
        FrameworkRequirement(
            id="vcs_crediting_period",
            section="Crediting Period",
            name="Crediting Period Definition",
            description="Is the crediting period type and length defined (7-year renewable or 10-year fixed)?",
            is_always_active=True,
            evidence_queries=["crediting period", "renewal period", "fixed crediting period"],
        ),
        FrameworkRequirement(
            id="vcs_leakage",
            section="Leakage",
            name="Leakage Assessment",
            description="Has leakage been assessed and quantified per methodology requirements?",
            is_always_active=True,
            evidence_queries=["leakage assessment", "activity shifting", "market leakage"],
        ),
        FrameworkRequirement(
            id="vcs_non_permanence",
            section="Non-Permanence",
            name="Non-Permanence Risk Assessment",
            description="Has a non-permanence risk analysis been completed with buffer pool contribution?",
            conditional_on=["afolu_project"],
            evidence_queries=["non-permanence risk", "buffer pool", "AFOLU risk assessment", "permanence"],
        ),
        FrameworkRequirement(
            id="vcs_double_counting",
            section="Double Counting",
            name="Double Counting and Corresponding Adjustments",
            description="Are measures in place to prevent double counting, including corresponding adjustments under Article 6?",
            is_always_active=True,
            evidence_queries=["double counting", "corresponding adjustment", "Article 6", "unique claim"],
        ),
        FrameworkRequirement(
            id="vcs_monitoring",
            section="Monitoring",
            name="Monitoring Plan",
            description="Is a monitoring plan in place specifying parameters, methods, frequency, and QA/QC?",
            is_always_active=True,
            evidence_queries=["monitoring plan", "monitoring parameters", "data quality"],
        ),
        FrameworkRequirement(
            id="vcs_stakeholder",
            section="Stakeholder Engagement",
            name="Stakeholder Consultation",
            description="Has stakeholder consultation been conducted per VCS requirements?",
            is_always_active=True,
            evidence_queries=["stakeholder consultation", "local stakeholder engagement", "public comment"],
        ),
        FrameworkRequirement(
            id="vcs_safeguards",
            section="Safeguards",
            name="Environmental and Social Safeguards",
            description="Has the project assessed and mitigated negative environmental and social impacts?",
            is_always_active=True,
            evidence_queries=["safeguards assessment", "no net harm", "environmental and social risks"],
        ),
        FrameworkRequirement(
            id="vcs_vvb",
            section="Validation / Verification",
            name="Validation and Verification Readiness",
            description="Is the project documentation sufficient for third-party validation/verification by a VVB?",
            is_always_active=True,
            evidence_queries=["validation body", "VVB", "verification readiness", "project design document"],
        ),
        FrameworkRequirement(
            id="vcs_registry",
            section="Registry",
            name="Registry and Issuance Readiness",
            description="Is the project prepared for Verra registry listing and credit issuance?",
            is_always_active=True,
            evidence_queries=["Verra registry", "VCU issuance", "credit issuance"],
        ),
    ],

    # ----------------------------------------------------------------
    # Gold Standard
    # ----------------------------------------------------------------
    "gold_standard": [
        FrameworkRequirement(
            id="gs_project_def",
            section="Project Definition",
            name="Project Description and Eligibility",
            description="Is the project clearly described with eligibility under Gold Standard rules?",
            is_always_active=True,
            evidence_queries=["Gold Standard eligibility", "project description", "GS4GG requirements"],
        ),
        FrameworkRequirement(
            id="gs_safeguarding",
            section="Safeguarding Principles",
            name="Safeguarding Assessment",
            description="Has the project completed a safeguarding principles assessment (do-no-harm)?",
            is_always_active=True,
            evidence_queries=["safeguarding principles", "do no harm assessment", "Gold Standard safeguards"],
        ),
        FrameworkRequirement(
            id="gs_gender",
            section="Gender Assessment",
            name="Gender Sensitivity and Inclusivity Assessment",
            description="Has a gender assessment been conducted to ensure project benefits are inclusive?",
            is_always_active=True,
            evidence_queries=["gender assessment", "gender sensitivity", "inclusivity", "women and girls"],
        ),
        FrameworkRequirement(
            id="gs_lsc_round1",
            section="Stakeholder Consultation",
            name="Local Stakeholder Consultation — Round 1 (Design)",
            description="Has the first-round LSC been conducted during project design with blind feedback?",
            is_always_active=True,
            evidence_queries=["local stakeholder consultation round 1", "LSC design phase", "blind consultation"],
        ),
        FrameworkRequirement(
            id="gs_lsc_round2",
            section="Stakeholder Consultation",
            name="Local Stakeholder Consultation — Round 2 (Implementation)",
            description="Has the second-round LSC been completed during implementation to validate design feedback?",
            is_always_active=True,
            evidence_queries=["local stakeholder consultation round 2", "LSC implementation", "follow-up consultation"],
        ),
        FrameworkRequirement(
            id="gs_theory_of_change",
            section="Theory of Change",
            name="Theory of Change / Outcome Statement",
            description="Has a theory of change been developed linking activities to SDG outcomes?",
            is_always_active=True,
            evidence_queries=["theory of change", "outcome statement", "impact pathway", "results chain"],
        ),
        FrameworkRequirement(
            id="gs_sdg",
            section="SDG Contribution",
            name="SDG Contribution and Impact Monitoring",
            description="Has the project identified SDG contributions beyond climate action (SDG 13)?",
            is_always_active=True,
            evidence_queries=["SDG contribution", "sustainable development goals", "SDG impact monitoring"],
        ),
        FrameworkRequirement(
            id="gs_sd_monitoring",
            section="SD Monitoring",
            name="Sustainable Development Monitoring Plan",
            description="Is an SD monitoring plan in place tracking SDG indicators over the crediting period?",
            is_always_active=True,
            evidence_queries=["SD monitoring plan", "sustainable development monitoring", "SDG indicators"],
        ),
        FrameworkRequirement(
            id="gs_additionality",
            section="Additionality",
            name="Additionality Demonstration",
            description="Has additionality been demonstrated per Gold Standard requirements?",
            is_always_active=True,
            evidence_queries=["additionality", "barrier analysis", "investment test"],
        ),
        FrameworkRequirement(
            id="gs_monitoring",
            section="Monitoring",
            name="Monitoring Plan",
            description="Is a monitoring plan established for emission reductions and SDG indicators?",
            is_always_active=True,
            evidence_queries=["monitoring plan", "monitoring report", "emission reduction monitoring"],
        ),
        FrameworkRequirement(
            id="gs_vvb",
            section="Validation / Verification",
            name="Validation and Verification Readiness",
            description="Is the project documentation ready for Gold Standard validation/verification?",
            is_always_active=True,
            evidence_queries=["Gold Standard validation", "VVB", "design certification"],
        ),
    ],

    # ----------------------------------------------------------------
    # ASTM Phase I / AAI Readiness
    # ----------------------------------------------------------------
    "astm_phase1": [
        FrameworkRequirement(
            id="astm_site_id",
            section="Site Identification",
            name="Subject Property Identification",
            description="Is the subject property clearly identified with address, legal description, and boundaries?",
            is_always_active=True,
            evidence_queries=["property identification", "site address", "legal description", "parcel boundary"],
        ),
        FrameworkRequirement(
            id="astm_historical",
            section="Historical Use",
            name="Historical Use Records",
            description="Has historical use of the property been researched (aerial photos, fire insurance maps, city directories)?",
            is_always_active=True,
            evidence_queries=["historical use", "Sanborn maps", "aerial photographs", "city directory"],
        ),
        FrameworkRequirement(
            id="astm_records",
            section="Records Review",
            name="Government Records Review",
            description="Have standard environmental record sources been reviewed (federal, state, local databases)?",
            is_always_active=True,
            evidence_queries=["environmental records review", "regulatory database", "CERCLIS", "RCRA", "UST"],
        ),
        FrameworkRequirement(
            id="astm_site_recon",
            section="Site Reconnaissance",
            name="Site Reconnaissance",
            description="Has a site visit been conducted to observe current conditions and potential contamination indicators?",
            is_always_active=True,
            evidence_queries=["site reconnaissance", "site visit", "visual inspection", "storage tanks"],
        ),
        FrameworkRequirement(
            id="astm_interviews",
            section="Interviews",
            name="Interviews and User-Provided Information",
            description="Have interviews with current/past owners, operators, and local officials been conducted?",
            is_always_active=True,
            evidence_queries=["owner interview", "operator interview", "user questionnaire"],
        ),
        FrameworkRequirement(
            id="astm_liens",
            section="Environmental Liens",
            name="Environmental Liens and Activity Use Limitations",
            description="Has a search for environmental liens and activity/use limitations (AULs) been conducted?",
            is_always_active=True,
            evidence_queries=["environmental lien", "activity use limitation", "AUL", "institutional control"],
        ),
        FrameworkRequirement(
            id="astm_vapor",
            section="Vapor Intrusion",
            name="Vapor Intrusion Screening",
            description="Has vapor intrusion potential been screened per ASTM E1527-21 requirements?",
            is_always_active=True,
            evidence_queries=["vapor intrusion", "subsurface vapor", "indoor air quality screening"],
        ),
        FrameworkRequirement(
            id="astm_adjoining",
            section="Adjoining Properties",
            name="Adjoining Property Assessment",
            description="Have adjoining properties been assessed for potential environmental conditions affecting the subject?",
            is_always_active=True,
            evidence_queries=["adjoining property", "neighboring parcels", "off-site contamination"],
        ),
        FrameworkRequirement(
            id="astm_ep_quals",
            section="EP Qualifications",
            name="Environmental Professional Qualifications",
            description="Does the EP meet qualifications per ASTM E1527 and 40 CFR 312?",
            is_always_active=True,
            evidence_queries=["environmental professional qualifications", "EP credentials", "40 CFR 312"],
        ),
        FrameworkRequirement(
            id="astm_rec",
            section="Findings",
            name="Recognized Environmental Conditions",
            description="Have recognized environmental conditions (RECs), controlled RECs, or historical RECs been identified?",
            is_always_active=True,
            evidence_queries=["recognized environmental condition", "REC", "CREC", "HREC", "de minimis"],
        ),
        FrameworkRequirement(
            id="astm_data_gaps",
            section="Data Gaps",
            name="Data Gaps and Report Completeness",
            description="Have data gaps been identified and assessed for their impact on findings?",
            is_always_active=True,
            evidence_queries=["data gap", "report completeness", "significant data gap", "limitation"],
        ),
        FrameworkRequirement(
            id="astm_shelf_life",
            section="Shelf Life",
            name="Shelf Life and Validity",
            description="Is the report within the 180-day shelf life and has the update been considered if needed?",
            is_always_active=True,
            evidence_queries=["shelf life", "report validity", "180 day", "update assessment"],
        ),
    ],
}


# ── Per-framework scope fact definitions ─────────────────────────────

FRAMEWORK_SCOPE_FACTS: dict[str, list[dict]] = {
    "ifc_ps": [
        {"id": "project_category", "label": "IFC Project Category", "type": "category_select",
         "options": ["A", "B", "C", "FI"],
         "option_descriptions": {"A": "High risk — significant adverse E&S impacts", "B": "Medium risk — limited adverse impacts", "C": "Minimal or no risk", "FI": "Financial intermediary"}},
        {"id": "financing_sources", "label": "Financing sources", "type": "multi_select",
         "options": ["IFC", "MIGA", "Other DFI co-financier", "Commercial bank", "Equity"]},
        {"id": "land_acquisition", "label": "Land acquisition or resettlement involvement", "type": "yes_no"},
        {"id": "indigenous_peoples", "label": "Indigenous Peoples interface", "type": "yes_no"},
        {"id": "biodiversity", "label": "Proximity to protected areas or critical habitats", "type": "yes_no"},
        {"id": "cultural_heritage", "label": "Cultural heritage presence", "type": "yes_no"},
        {"id": "significant_ghg", "label": "Significant GHG emissions expected", "type": "yes_no"},
        {"id": "supply_chain_risk", "label": "Supply chain labor risk identified", "type": "yes_no"},
    ],
    "world_bank_esf": [
        {"id": "risk_classification", "label": "World Bank Risk Classification", "type": "category_select",
         "options": ["High", "Substantial", "Moderate", "Low"],
         "option_descriptions": {"High": "Full ESS1-ESS10 apply", "Substantial": "ESS1-ESS8 + ESS10", "Moderate": "ESS1-ESS4 + ESS10", "Low": "ESS1 + ESS10 only"}},
        {"id": "instrument_type", "label": "Financing instrument", "type": "select",
         "options": ["IPF", "DPF", "PforR"]},
        {"id": "sovereign_borrower", "label": "Sovereign / government borrower", "type": "yes_no"},
        {"id": "financial_intermediary", "label": "Lending through financial intermediaries", "type": "yes_no"},
        {"id": "land_acquisition", "label": "Land acquisition or resettlement involvement", "type": "yes_no"},
        {"id": "indigenous_peoples", "label": "Indigenous Peoples interface", "type": "yes_no"},
        {"id": "biodiversity", "label": "Proximity to protected areas or critical habitats", "type": "yes_no"},
        {"id": "cultural_heritage", "label": "Cultural heritage presence", "type": "yes_no"},
    ],
    "equator_principles": [
        {"id": "ep_category", "label": "EP Project Category", "type": "category_select",
         "options": ["A", "B", "C"],
         "option_descriptions": {"A": "Significant adverse E&S impacts — full EP apply", "B": "Limited adverse impacts — reduced scope", "C": "Minimal or no impacts — Principle 1 only"}},
        {"id": "financing_type", "label": "Financing type", "type": "select",
         "options": ["Project Finance", "Project-Related Corporate Loan", "Bridge Loan", "Advisory"]},
        {"id": "financing_sources", "label": "Financing sources", "type": "multi_select",
         "options": ["EPFI commercial bank", "DFI co-financier", "Export credit agency", "Equity"]},
        {"id": "designated_country", "label": "Project in an EP Designated Country", "type": "yes_no"},
        {"id": "significant_ghg", "label": "Significant GHG emissions expected", "type": "yes_no"},
        {"id": "conflict_affected", "label": "Project in conflict-affected or high-risk area", "type": "yes_no"},
    ],
    "verra_vcs": [
        {"id": "vcs_methodology", "label": "VCS Methodology ID", "type": "text"},
        {"id": "activity_type", "label": "Activity type", "type": "select",
         "options": ["Renewable Energy", "Energy Efficiency", "AFOLU", "Waste", "Transport", "Other"]},
        {"id": "afolu_project", "label": "AFOLU project (triggers non-permanence buffer)", "type": "yes_no"},
        {"id": "grouped_project", "label": "Grouped project", "type": "yes_no"},
        {"id": "crediting_period_type", "label": "Crediting period type", "type": "select",
         "options": ["7-year renewable", "10-year fixed"]},
    ],
    "gold_standard": [
        {"id": "gs_activity_type", "label": "Activity type", "type": "select",
         "options": ["Renewable Energy", "Energy Efficiency", "Clean Cookstoves", "Water", "Waste", "Other"]},
        {"id": "sdg_targets", "label": "Targeted SDGs beyond SDG 13", "type": "text"},
        {"id": "microscale", "label": "Microscale project (simplified rules)", "type": "yes_no"},
        {"id": "retroactive_crediting", "label": "Retroactive crediting sought", "type": "yes_no"},
    ],
    "astm_phase1": [
        {"id": "property_type", "label": "Property type", "type": "select",
         "options": ["Commercial", "Industrial", "Residential", "Undeveloped", "Mixed-use"]},
        {"id": "transaction_type", "label": "Transaction type", "type": "select",
         "options": ["Acquisition", "Refinancing", "Foreclosure", "Other"]},
        {"id": "prior_phase1_exists", "label": "Prior Phase I ESA exists", "type": "yes_no"},
        {"id": "known_contamination", "label": "Known contamination on site", "type": "yes_no"},
    ],
}

# Legacy alias kept for backward compat with any import
SCOPE_FACTS: list[dict] = [
    {"id": "financing_source", "label": "Financing source or lender type", "frameworks": ["ifc_ps", "world_bank_esf", "equator_principles"]},
    {"id": "sovereign_financing", "label": "Sovereign / government borrower involvement", "frameworks": ["world_bank_esf"]},
    {"id": "carbon_intent", "label": "Carbon credit certification intent", "frameworks": ["verra_vcs", "gold_standard"]},
    {"id": "land_acquisition", "label": "Land acquisition or resettlement involvement", "frameworks": ["ifc_ps", "world_bank_esf"]},
    {"id": "indigenous_peoples", "label": "Indigenous Peoples interface", "frameworks": ["ifc_ps", "world_bank_esf"]},
    {"id": "us_site_transaction", "label": "U.S. site / property transaction context", "frameworks": ["astm_phase1"]},
    {"id": "biodiversity", "label": "Proximity to protected areas or critical habitats", "frameworks": ["ifc_ps", "world_bank_esf"]},
    {"id": "cultural_heritage", "label": "Cultural heritage presence", "frameworks": ["ifc_ps", "world_bank_esf"]},
    {"id": "high_ghg", "label": "Significant GHG emissions expected", "frameworks": ["equator_principles"]},
    {"id": "conflict_area", "label": "Project in conflict-affected or high-risk area", "frameworks": ["equator_principles"]},
]


def get_framework_list() -> list[dict]:
    """Return all supported frameworks as dicts."""
    return [fm.to_dict() for fm in FRAMEWORK_FAMILIES.values()]


def get_requirement_tree(framework_id: str) -> list[dict]:
    """Return the requirement tree for a given framework as a list of dicts."""
    reqs = REQUIREMENT_TREES.get(framework_id, [])
    return [r.to_dict() for r in reqs]


def get_requirements_for_framework(framework_id: str) -> list[FrameworkRequirement]:
    """Return raw FrameworkRequirement objects for a given framework."""
    return REQUIREMENT_TREES.get(framework_id, [])


def get_scope_facts_for_framework(framework_id: str) -> list[dict]:
    """Return the per-framework scope fact definitions."""
    return FRAMEWORK_SCOPE_FACTS.get(framework_id, [])
