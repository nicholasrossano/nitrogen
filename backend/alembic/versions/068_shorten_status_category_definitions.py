"""Shorten default project status category definitions.

Revision ID: 068
Revises: 067
Create Date: 2026-07-17

Updates only rows still on the original seeded definition text so user edits
are preserved.
"""

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text


revision: str = "068"
down_revision: str | None = "067"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (category_key, old_definition, new_definition)
_DEFINITION_UPDATES: tuple[tuple[str, str, str], ...] = (
    (
        "evidence_credibility",
        (
            "Evidence and credibility means material project claims are supported by traceable sources, "
            "variables are explicit and validated where possible, and there are no major contradictions "
            "between what the project asserts and what the record shows."
        ),
        (
            "Material claims are backed by traceable sources, with no major contradictions "
            "in the project record."
        ),
    ),
    (
        "technical_viability",
        (
            "Technical viability means the proposed design, sizing, and modeled outputs are coherent for "
            "this site and use case, key technical inputs are present, and there is no sign the configuration "
            "is infeasible or based on invalid analysis."
        ),
        "The proposed design and modeled outputs are coherent for this site and use case.",
    ),
    (
        "funding_economics",
        (
            "Funding and economics means the project's cost, revenue, and funding logic hang together, "
            "the use-of-funds story is legible to funders or approvers, and the economic case is directionally "
            "credible even if not yet decision-grade."
        ),
        "Cost, revenue, and funding logic hang together and look directionally credible.",
    ),
    (
        "deployment_readiness",
        (
            "Deployment readiness means a credible path to build and operate: named owners for critical "
            "workstreams, a realistic timeline with key milestones, identified dependencies such as permits, "
            "partners, and procurement, and no unresolved blockers that would prevent starting construction "
            "or operations."
        ),
        "A credible path to build and operate exists, with owners and no unresolved blockers.",
    ),
    (
        "risk_profile",
        (
            "Risk profile means material risks and dependencies are identified, severity and ownership are "
            "understood, mitigation paths exist for the most important items, and no severe unmitigated blocker "
            "currently dominates the project's trajectory."
        ),
        "Material risks are identified, owned, and mitigated for the most important items.",
    ),
)


def upgrade() -> None:
    conn = op.get_bind()
    for category_key, old_text, new_text in _DEFINITION_UPDATES:
        conn.execute(
            text(
                """
                UPDATE project_status_categories
                SET definition_text = :new_text
                WHERE category_key = :category_key
                  AND definition_text = :old_text
                """
            ),
            {
                "category_key": category_key,
                "old_text": old_text,
                "new_text": new_text,
            },
        )


def downgrade() -> None:
    conn = op.get_bind()
    for category_key, old_text, new_text in _DEFINITION_UPDATES:
        conn.execute(
            text(
                """
                UPDATE project_status_categories
                SET definition_text = :old_text
                WHERE category_key = :category_key
                  AND definition_text = :new_text
                """
            ),
            {
                "category_key": category_key,
                "old_text": old_text,
                "new_text": new_text,
            },
        )
