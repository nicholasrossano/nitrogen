"""Revert assessment_instances.assessment_id → tool_id (model was never updated for 032 rename)

Revision ID: 033
Revises: 032
Create Date: 2026-03-30

"""
from alembic import op

revision = '033'
down_revision = '032'
branch_labels = None
depends_on = None


def upgrade():
    # Drop the index created by 032 (on assessment_id)
    op.drop_index('ix_mi_initiative_assessment', table_name='assessment_instances')

    # Rename assessment_id back to tool_id to match the Python model
    op.alter_column('assessment_instances', 'assessment_id', new_column_name='tool_id')

    # Recreate the index on the correct column name
    op.create_index('ix_mi_initiative_assessment', 'assessment_instances',
                    ['initiative_id', 'tool_id'])


def downgrade():
    op.drop_index('ix_mi_initiative_assessment', table_name='assessment_instances')
    op.alter_column('assessment_instances', 'tool_id', new_column_name='assessment_id')
    op.create_index('ix_mi_initiative_assessment', 'assessment_instances',
                    ['initiative_id', 'assessment_id'])
