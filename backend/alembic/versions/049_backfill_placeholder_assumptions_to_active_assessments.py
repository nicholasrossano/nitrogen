"""Backfill missing placeholders to active assessment instances only.

Revision ID: 049
Revises: 048
Create Date: 2026-05-01
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "049"
down_revision: str | None = "048"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Remove stale "missing placeholder" assumptions that were created from planned
    # assessment selections but do not map to any currently active assessment instance.
    op.execute(
        """
        DELETE FROM assumptions AS a
        WHERE a.source_type = 'missing_placeholder'
          AND a.status = 'missing'
          AND COALESCE(jsonb_typeof(a.source_reference -> 'required_for_assessments'), '') = 'array'
          AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(a.source_reference -> 'required_for_assessments') AS req(assessment_id)
              JOIN assessment_instances AS mi
                ON mi.initiative_id = a.initiative_id
               AND mi.assessment_id = req.assessment_id
               AND COALESCE(mi.archived, false) = false
          );
        """
    )


def downgrade() -> None:
    # Data cleanup is not reversible.
    pass
