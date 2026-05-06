"""Energy-domain project health definitions and guardrails."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class HealthDimensionDefinition:
    id: str
    label: str
    description: str
    relevant_assessment_ids: tuple[str, ...] = ()
    green_blockers: tuple[str, ...] = ()
    red_triggers: tuple[str, ...] = ()
    yellow_defaults: tuple[str, ...] = ()
    llm_prompt_guidance: tuple[str, ...] = ()
    retrieval_queries: tuple[str, ...] = ()


@dataclass(frozen=True)
class ProjectHealthDefinition:
    domain: str
    dimensions: tuple[HealthDimensionDefinition, ...]
    stage_expectations: dict[str, str] = field(default_factory=dict)


def get_project_health_definition() -> ProjectHealthDefinition:
    """Return the stable energy-domain project health dimensions."""
    return ProjectHealthDefinition(
        domain="energy",
        stage_expectations={
            "describe": "Green means enough structure to continue exploration.",
            "plan": "Green means assumptions and evidence are coherent for analysis planning.",
            "execute": "Green means execution blockers are controlled and evidence is decision-ready.",
            "review": "Green means package quality is credible for external review.",
            "generate": "Green means outputs are coherent and materially supported.",
            "complete": "Green means project artifacts are complete enough for handoff.",
        },
        dimensions=(
            HealthDimensionDefinition(
                id="funding_readiness",
                label="Funding readiness",
                description="How legible and decision-ready the project is for funders or approvers.",
                relevant_assessment_ids=("lcoe_model", "implementation_plan", "risk_assessment"),
                green_blockers=(
                    "core_claims_unsupported",
                    "required_assumptions_missing",
                    "relevant_analysis_stale_or_missing",
                    "high_severity_blockers_open",
                ),
                red_triggers=(
                    "critical_dependency_missing",
                    "major_claim_evidence_contradiction",
                    "required_package_material_missing",
                ),
                yellow_defaults=(
                    "funding_pathway_partially_defined",
                    "credible_but_not_decision_grade",
                ),
                llm_prompt_guidance=(
                    "Focus on funder legibility, use-of-funds clarity, and diligence readiness.",
                ),
                retrieval_queries=(
                    "funding ask use of funds funder fit grant investment readiness donor memo approval packet budget diligence gaps",
                    "evidence supporting funding narrative financial need application materials unresolved funding gaps",
                ),
            ),
            HealthDimensionDefinition(
                id="deployment_readiness",
                label="Deployment readiness",
                description="Operational clarity and feasibility of executing the project.",
                relevant_assessment_ids=("implementation_plan", "stakeholder_assessment", "landscape_mapping"),
                green_blockers=(
                    "implementation_ownership_unclear",
                    "unresolved_procurement_or_partner_dependencies",
                    "key_milestones_missing",
                ),
                red_triggers=(
                    "critical_site_or_permitting_blocker",
                    "no_owner_for_critical_dependency",
                ),
                yellow_defaults=(
                    "execution_path_exists_but_gaps_remain",
                    "moderate_unresolved_dependencies",
                ),
                llm_prompt_guidance=(
                    "Prioritize ownership, dependencies, milestones, and feasibility signals.",
                ),
                retrieval_queries=(
                    "implementation plan operating model delivery model partners procurement milestones ownership dependencies site readiness staffing permits timeline",
                    "execution readiness delivery dependencies owners milestones budget implementation risks",
                ),
            ),
            HealthDimensionDefinition(
                id="evidence_strength",
                label="Evidence strength",
                description="Strength and coverage of support for material project claims.",
                green_blockers=(
                    "material_claims_unsupported",
                    "assumptions_unverified_or_missing",
                    "evidence_stale_or_conflicting",
                ),
                red_triggers=(
                    "major_contradiction_between_claim_and_evidence",
                    "critical_source_missing_for_stage",
                ),
                yellow_defaults=(
                    "partial_claim_coverage",
                    "directional_support_with_open_validation",
                ),
                llm_prompt_guidance=(
                    "Assess claim-to-evidence coverage, source quality, and unresolved assumptions.",
                ),
                retrieval_queries=(
                    "cited claims evidence annex source quality uploaded documents validated assumptions unsupported claims contradictions calculations citation coverage",
                    "project claims supporting evidence source quality assumptions calculations contradictions",
                ),
            ),
            HealthDimensionDefinition(
                id="technical_viability",
                label="Technical viability",
                description="Whether technical design and modeled outputs support the proposal.",
                relevant_assessment_ids=("solar_estimate", "lcoe_model"),
                green_blockers=(
                    "technical_inputs_incomplete",
                    "relevant_module_not_run_or_stale",
                    "low_model_confidence",
                ),
                red_triggers=(
                    "technical_module_reports_infeasible_configuration",
                    "failed_or_invalid_technical_output",
                ),
                yellow_defaults=(
                    "plausible_technical_path_with_unverified_inputs",
                ),
                llm_prompt_guidance=(
                    "Ground rationale in available technical module output and input quality.",
                ),
                retrieval_queries=(
                    "technical sizing system design solar yield LCOE PVWatts REopt SAM PySAM site constraints technical assumptions equipment load profile feasibility",
                    "technical feasibility system design equipment site constraints energy yield technical assumptions",
                ),
            ),
            HealthDimensionDefinition(
                id="financial_viability",
                label="Financial viability",
                description="Coherence and defensibility of economics, costs, and funding logic.",
                relevant_assessment_ids=("lcoe_model", "carbon_model"),
                green_blockers=(
                    "financial_model_not_run_or_stale",
                    "critical_cost_or_revenue_assumptions_missing",
                    "high_dependence_on_unverified_inputs",
                ),
                red_triggers=(
                    "financial_logic_contradiction",
                    "model_output_invalid_or_failed",
                ),
                yellow_defaults=(
                    "economics_directional_not_decision_grade",
                ),
                llm_prompt_guidance=(
                    "Avoid universal numeric thresholds; focus on coherence and support quality.",
                ),
                retrieval_queries=(
                    "CAPEX OPEX unit economics LCOE revenue subsidy funding gap payback cost recovery cash flow supplier quotes financial assumptions",
                    "financial viability costs budget funding need economics cash flow revenue operating expenses capital expenses",
                ),
            ),
            HealthDimensionDefinition(
                id="risk_profile",
                label="Risk profile",
                description="Severity and management status of unresolved blockers and dependencies.",
                relevant_assessment_ids=("risk_assessment", "implementation_plan"),
                green_blockers=(
                    "high_severity_risks_open",
                    "unowned_or_unmitigated_key_risks",
                ),
                red_triggers=(
                    "severe_unmitigated_risk",
                    "compliance_or_dependency_blocker_unresolved",
                ),
                yellow_defaults=(
                    "moderate_risks_with_partial_mitigation",
                ),
                llm_prompt_guidance=(
                    "Emphasize unresolved severity, ownership, and mitigation confidence.",
                ),
                retrieval_queries=(
                    "risk register blockers mitigations dependencies compliance gaps environmental social screening permitting unresolved risks severity likelihood ownership",
                    "project risks mitigations blockers dependencies unresolved issues ownership compliance permitting",
                ),
            ),
        ),
    )
