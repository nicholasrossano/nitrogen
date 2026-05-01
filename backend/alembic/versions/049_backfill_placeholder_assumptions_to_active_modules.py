"""Backfill missing placeholders to active module instances only.

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
    # module selections but do not map to any currently active module instance.
    op.execute(
        """
        DELETE FROM assumptions AS a
        WHERE a.source_type = 'missing_placeholder'
          AND a.status = 'missing'
          AND COALESCE(jsonb_typeof(a.source_reference -> 'required_for_modules'), '') = 'array'
          AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(a.source_reference -> 'required_for_modules') AS req(module_id)
              JOIN module_instances AS mi
                ON mi.initiative_id = a.initiative_id
               AND mi.module_id = req.module_id
               AND COALESCE(mi.archived, false) = false
          );
        """
    )


def downgrade() -> None:
    # Data cleanup is not reversible.
    pass
