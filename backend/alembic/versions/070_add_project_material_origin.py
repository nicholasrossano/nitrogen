"""Add origin to project_materials (upload vs generated).

Revision ID: 070
Revises: 069
Create Date: 2026-07-17

Expand-only: default 'upload' keeps existing rows production-safe.
Backfill marks assessment report DOCX rows as generated.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "070"
down_revision: str | None = "069"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "project_materials",
        sa.Column(
            "origin",
            sa.String(length=32),
            nullable=False,
            server_default="upload",
        ),
    )

    # Assessment Report upserts store report_material_id on workflow_state.
    op.execute(
        """
        UPDATE project_materials AS pm
        SET origin = 'generated'
        FROM assessment_instances AS ai
        WHERE ai.workflow_state ? 'report_material_id'
          AND (ai.workflow_state->>'report_material_id') ~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND (ai.workflow_state->>'report_material_id')::uuid = pm.id
        """
    )

    # Filename convention from _assessment_report_filename: *_report.docx
    op.execute(
        """
        UPDATE project_materials
        SET origin = 'generated'
        WHERE origin = 'upload'
          AND filename ~* '_report\\.docx$'
        """
    )

    # Older publish naming from _assessment_export_filename:
    # {assessment}_n{N}_{creator}_{YYYY-MM-DD}_{HHMM}.{ext}
    op.execute(
        """
        UPDATE project_materials
        SET origin = 'generated'
        WHERE origin = 'upload'
          AND filename ~*
              '^[a-z0-9][a-z0-9._-]*_n[0-9]+_.+_\\d{4}-\\d{2}-\\d{2}_\\d{4}\\.(docx|xlsx|pptx)$'
        """
    )


def downgrade() -> None:
    op.drop_column("project_materials", "origin")
