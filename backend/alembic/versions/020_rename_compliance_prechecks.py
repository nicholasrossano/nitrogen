"""Rename compliance_precheck to compliance_prechecks (keyed dict)

Revision ID: 020
Revises: 019
Create Date: 2026-03-12

Migrates from a single JSONB object to a keyed dict where each key
is a framework_id and the value is that framework's pre-check result.
Existing data is wrapped into { <framework_id>: <existing_data> }.
"""
from alembic import op

revision = '020'
down_revision = '019'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column('initiatives', 'compliance_precheck', new_column_name='compliance_prechecks')

    # Wrap existing single-framework results into the keyed dict shape
    op.execute("""
        UPDATE initiatives
        SET compliance_prechecks = jsonb_build_object(
            compliance_prechecks->'framework'->>'id',
            compliance_prechecks
        )
        WHERE compliance_prechecks IS NOT NULL
          AND compliance_prechecks->'framework'->>'id' IS NOT NULL
    """)


def downgrade() -> None:
    # Extract the first value from the keyed dict back to a single object
    op.execute("""
        UPDATE initiatives
        SET compliance_prechecks = (
            SELECT value FROM jsonb_each(compliance_prechecks) LIMIT 1
        )
        WHERE compliance_prechecks IS NOT NULL
    """)

    op.alter_column('initiatives', 'compliance_prechecks', new_column_name='compliance_precheck')
