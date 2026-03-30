"""Add archived column to module_instances for soft-delete (trash) support

Revision ID: 035
Revises: 034
Create Date: 2026-03-30

"""
from alembic import op
import sqlalchemy as sa

revision = '035'
down_revision = '034'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'module_instances',
        sa.Column('archived', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.create_index(
        'ix_mi_initiative_archived',
        'module_instances',
        ['initiative_id', 'archived'],
    )


def downgrade():
    op.drop_index('ix_mi_initiative_archived', table_name='module_instances')
    op.drop_column('module_instances', 'archived')
