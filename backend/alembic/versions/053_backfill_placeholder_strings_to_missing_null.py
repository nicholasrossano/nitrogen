"""Backfill placeholder-like strings to missing/null assumptions.

Revision ID: 053
Revises: 052
Create Date: 2026-05-01
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "053"
down_revision: str | None = "052"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE assumptions
        SET
          value = 'null'::jsonb,
          status = 'missing',
          source_type = CASE
            WHEN source_type IN ('extraction', 'model_candidate', 'assessment', 'user_input', 'default')
              THEN source_type
            ELSE 'missing_placeholder'
          END
        WHERE jsonb_typeof(value) = 'string'
          AND (
            lower(trim(value #>> '{}')) IN (
              '', '—', '-', '–', 'n/a', 'na', 'none', 'null', 'missing', 'tbd', 'unknown', 'not available', 'not provided'
            )
            OR lower(trim(value #>> '{}')) LIKE 'unknown %'
          );
        """
    )


def downgrade() -> None:
    # Data normalization is not reversible.
    pass
