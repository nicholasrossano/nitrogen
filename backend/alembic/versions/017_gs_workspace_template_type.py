"""Add template_type to GS workspace for multi-document support

Revision ID: 017
Revises: 016
Create Date: 2026-03-11

"""
from alembic import op
import sqlalchemy as sa

revision = '017'
down_revision = '016'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'gs_certification_workspaces',
        sa.Column('template_type', sa.String(50), nullable=False, server_default='cover_letter'),
    )
    op.create_index(
        'ix_gs_workspace_template_type',
        'gs_certification_workspaces',
        ['template_type'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_gs_workspace_template_type', 'gs_certification_workspaces')
    op.drop_column('gs_certification_workspaces', 'template_type')
