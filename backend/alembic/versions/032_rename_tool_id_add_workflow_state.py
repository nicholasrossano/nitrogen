"""Rename assessment_instances.tool_id → assessment_id and add workflow_state JSONB column

Revision ID: 032
Revises: 031
Create Date: 2026-03-30

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '032'
down_revision = '031'
branch_labels = None
depends_on = None


def upgrade():
    # Drop old index on (initiative_id, tool_id)
    op.drop_index('ix_mi_initiative_tool', table_name='assessment_instances')

    # Rename column
    op.alter_column('assessment_instances', 'tool_id', new_column_name='assessment_id')

    # Re-create index on (initiative_id, assessment_id)
    op.create_index('ix_mi_initiative_assessment', 'assessment_instances',
                    ['initiative_id', 'assessment_id'])

    # Add workflow_state JSONB column (nullable)
    op.add_column(
        'assessment_instances',
        sa.Column('workflow_state', postgresql.JSONB, nullable=True),
    )


def downgrade():
    op.drop_column('assessment_instances', 'workflow_state')

    op.drop_index('ix_mi_initiative_assessment', table_name='assessment_instances')
    op.alter_column('assessment_instances', 'assessment_id', new_column_name='tool_id')
    op.create_index('ix_mi_initiative_tool', 'assessment_instances',
                    ['initiative_id', 'tool_id'])
