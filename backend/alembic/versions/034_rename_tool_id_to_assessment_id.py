"""Rename assessment_instances.tool_id → assessment_id (model now updated)

Revision ID: 034
Revises: 033
Create Date: 2026-03-30

"""
from alembic import op

revision = '034'
down_revision = '033'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_index('ix_mi_initiative_assessment', table_name='assessment_instances')
    op.alter_column('assessment_instances', 'tool_id', new_column_name='assessment_id')
    op.create_index('ix_mi_initiative_assessment', 'assessment_instances',
                    ['initiative_id', 'assessment_id'])


def downgrade():
    op.drop_index('ix_mi_initiative_assessment', table_name='assessment_instances')
    op.alter_column('assessment_instances', 'assessment_id', new_column_name='tool_id')
    op.create_index('ix_mi_initiative_assessment', 'assessment_instances',
                    ['initiative_id', 'tool_id'])
