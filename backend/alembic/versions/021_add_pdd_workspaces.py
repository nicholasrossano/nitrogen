"""Add pdd_workspaces table

Revision ID: 021
Revises: 020
Create Date: 2026-03-12

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = '021'
down_revision = '020'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'pdd_workspaces',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('initiative_id', UUID(as_uuid=True), sa.ForeignKey('initiatives.id', ondelete='CASCADE'), nullable=True, index=True),
        sa.Column('session_id', UUID(as_uuid=True), sa.ForeignKey('core_chat_sessions.id', ondelete='CASCADE'), nullable=True, index=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='scan'),
        sa.Column('project_scan', JSONB, nullable=True),
        sa.Column('outline', JSONB, nullable=True),
        sa.Column('sections', JSONB, nullable=True),
        sa.Column('active_section_id', sa.String(100), nullable=True),
        sa.Column('consistency_findings', JSONB, nullable=True),
        sa.Column('assembled_document', JSONB, nullable=True),
        sa.Column('missing_items_global', JSONB, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('pdd_workspaces')
