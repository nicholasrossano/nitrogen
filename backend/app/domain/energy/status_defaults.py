"""Default status category starters for the energy domain."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DefaultStatusCategory:
    category_key: str
    label: str
    definition_text: str


@dataclass(frozen=True)
class DefaultStatusCategoryPack:
    domain: str
    categories: tuple[DefaultStatusCategory, ...]
    stage_expectations: dict[str, str]


def get_default_status_categories() -> DefaultStatusCategoryPack:
    """Return five editable starter status categories for new projects."""
    return DefaultStatusCategoryPack(
        domain="energy",
        stage_expectations={
            "describe": "Assessment means enough structure exists to continue exploration.",
            "plan": "Assessment means assumptions and evidence are coherent for analysis planning.",
            "execute": "Assessment means execution blockers are controlled and evidence is decision-ready.",
            "review": "Assessment means package quality is credible for external review.",
            "generate": "Assessment means outputs are coherent and materially supported.",
            "complete": "Assessment means project artifacts are complete enough for handoff.",
        },
        categories=(
            DefaultStatusCategory(
                category_key="evidence_credibility",
                label="Evidence & credibility",
                definition_text=(
                    "Evidence and credibility means material project claims are supported by traceable sources, "
                    "assumptions are explicit and validated where possible, and there are no major contradictions "
                    "between what the project asserts and what the record shows."
                ),
            ),
            DefaultStatusCategory(
                category_key="technical_viability",
                label="Technical viability",
                definition_text=(
                    "Technical viability means the proposed design, sizing, and modeled outputs are coherent for "
                    "this site and use case, key technical inputs are present, and there is no sign the configuration "
                    "is infeasible or based on invalid analysis."
                ),
            ),
            DefaultStatusCategory(
                category_key="funding_economics",
                label="Funding & economics",
                definition_text=(
                    "Funding and economics means the project's cost, revenue, and funding logic hang together, "
                    "the use-of-funds story is legible to funders or approvers, and the economic case is directionally "
                    "credible even if not yet decision-grade."
                ),
            ),
            DefaultStatusCategory(
                category_key="deployment_readiness",
                label="Deployment readiness",
                definition_text=(
                    "Deployment readiness means a credible path to build and operate: named owners for critical "
                    "workstreams, a realistic timeline with key milestones, identified dependencies such as permits, "
                    "partners, and procurement, and no unresolved blockers that would prevent starting construction "
                    "or operations."
                ),
            ),
            DefaultStatusCategory(
                category_key="risk_profile",
                label="Risk profile",
                definition_text=(
                    "Risk profile means material risks and dependencies are identified, severity and ownership are "
                    "understood, mitigation paths exist for the most important items, and no severe unmitigated blocker "
                    "currently dominates the project's trajectory."
                ),
            ),
        ),
    )
