"""Backfill project shares for workspace members before project-scoped access.

Revision ID: 063
Revises: 062
Create Date: 2026-06-18
"""

from collections.abc import Sequence

from alembic import op


revision: str = "063"
down_revision: str | None = "062"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO project_shares (id, project_id, user_id, role, shared_by, created_at)
        SELECT
            gen_random_uuid(),
            p.id,
            wm.user_id,
            'editor',
            p.created_by,
            NOW()
        FROM projects p
        JOIN workspace_memberships wm ON wm.workspace_id = p.workspace_id
        WHERE wm.user_id <> p.created_by
          AND NOT EXISTS (
            SELECT 1
            FROM project_shares ps
            WHERE ps.project_id = p.id
              AND ps.user_id = wm.user_id
          )
        """
    )


def downgrade() -> None:
    pass
