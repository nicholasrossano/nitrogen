"""Normalize legacy assumption statuses after projects migration.

Revision ID: 062
Revises: 061
Create Date: 2026-06-17
"""

from collections.abc import Sequence

from alembic import op


revision: str = "062"
down_revision: str | None = "061"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE assumptions
        SET status = 'extracted'
        WHERE status IN ('needs_review', 'inferred');
        """
    )
    op.execute(
        """
        DELETE FROM assumptions
        WHERE key = 'promoted_finding_summary';
        """
    )


def downgrade() -> None:
    pass
