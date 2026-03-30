"""Revert module_instances.module_id → tool_id (model was never updated for 032 rename)

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
    # Drop the index created by 032 (on module_id)
    op.drop_index('ix_mi_initiative_module', table_name='module_instances')

    # Rename module_id back to tool_id to match the Python model
    op.alter_column('module_instances', 'module_id', new_column_name='tool_id')

    # Recreate the index on the correct column name
    op.create_index('ix_mi_initiative_module', 'module_instances',
                    ['initiative_id', 'tool_id'])


def downgrade():
    op.drop_index('ix_mi_initiative_module', table_name='module_instances')
    op.alter_column('module_instances', 'tool_id', new_column_name='module_id')
    op.create_index('ix_mi_initiative_module', 'module_instances',
                    ['initiative_id', 'module_id'])
