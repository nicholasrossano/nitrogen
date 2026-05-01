"""Rename inferred status labels to extracted.

Revision ID: 047
Revises: 046
Create Date: 2026-04-30
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "047"
down_revision: str | None = "046"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE assumptions
        SET status = 'extracted'
        WHERE status IN ('inferred', 'needs_review');
        """
    )

    op.execute(
        """
        UPDATE module_instances
        SET workflow_state = REPLACE(workflow_state::text, '"inferred"', '"extracted"')::jsonb
        WHERE workflow_state::text LIKE '%"inferred"%';
        """
    )

    op.execute(
        """
        UPDATE chat_messages
        SET widget_data = REPLACE(widget_data::text, '"inferred"', '"extracted"')::jsonb
        WHERE widget_data IS NOT NULL
          AND widget_data::text LIKE '%"inferred"%';
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE assumptions
        SET status = 'inferred'
        WHERE status = 'extracted';
        """
    )

    op.execute(
        """
        UPDATE module_instances
        SET workflow_state = REPLACE(workflow_state::text, '"extracted"', '"inferred"')::jsonb
        WHERE workflow_state::text LIKE '%"extracted"%';
        """
    )

    op.execute(
        """
        UPDATE chat_messages
        SET widget_data = REPLACE(widget_data::text, '"extracted"', '"inferred"')::jsonb
        WHERE widget_data IS NOT NULL
          AND widget_data::text LIKE '%"extracted"%';
        """
    )
