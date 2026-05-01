"""Normalize missing assumption placeholder values to null.

Revision ID: 052
Revises: 051
Create Date: 2026-05-01
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "052"
down_revision: str | None = "051"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE assumptions
        SET value = 'null'::jsonb
        WHERE status = 'missing'
          AND jsonb_typeof(value) = 'string'
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
