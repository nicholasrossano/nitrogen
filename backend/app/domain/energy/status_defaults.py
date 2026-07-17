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
            "plan": "Assessment means variables and evidence are coherent for analysis planning.",
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
                    "Material claims are backed by traceable sources, with no major contradictions "
                    "in the project record."
                ),
            ),
            DefaultStatusCategory(
                category_key="technical_viability",
                label="Technical viability",
                definition_text=(
                    "The proposed design and modeled outputs are coherent for this site and use case."
                ),
            ),
            DefaultStatusCategory(
                category_key="funding_economics",
                label="Funding & economics",
                definition_text=(
                    "Cost, revenue, and funding logic hang together and look directionally credible."
                ),
            ),
            DefaultStatusCategory(
                category_key="deployment_readiness",
                label="Deployment readiness",
                definition_text=(
                    "A credible path to build and operate exists, with owners and no unresolved blockers."
                ),
            ),
            DefaultStatusCategory(
                category_key="risk_profile",
                label="Risk profile",
                definition_text=(
                    "Material risks are identified, owned, and mitigated for the most important items."
                ),
            ),
        ),
    )
