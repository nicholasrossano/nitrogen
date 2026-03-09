"""Add GS certification tables for template versioning and workspaces

Revision ID: 015
Revises: 014
Create Date: 2026-03-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '015'
down_revision = '014'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'gs_template_versions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('template_type', sa.String(50), nullable=False, index=True),
        sa.Column('version_label', sa.String(100), nullable=True),
        sa.Column('source_url', sa.Text(), nullable=True),
        sa.Column('file_hash', sa.String(64), nullable=False),
        sa.Column('file_bytes', sa.LargeBinary(), nullable=False),
        sa.Column('html_preview', sa.Text(), nullable=True),
        sa.Column('field_schema', postgresql.JSONB(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='draft'),
        sa.Column('approved_by', sa.String(255), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        'gs_certification_workspaces',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('initiative_id', postgresql.UUID(as_uuid=True),
                   sa.ForeignKey('initiatives.id', ondelete='CASCADE'),
                   nullable=True, index=True),
        sa.Column('session_id', postgresql.UUID(as_uuid=True),
                   sa.ForeignKey('core_chat_sessions.id', ondelete='CASCADE'),
                   nullable=True, index=True),
        sa.Column('template_version_id', postgresql.UUID(as_uuid=True),
                   sa.ForeignKey('gs_template_versions.id', ondelete='RESTRICT'),
                   nullable=False),
        sa.Column('field_values', postgresql.JSONB(), nullable=True),
        sa.Column('checklist_state', postgresql.JSONB(), nullable=True),
        sa.Column('export_history', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('gs_certification_workspaces')
    op.drop_table('gs_template_versions')
