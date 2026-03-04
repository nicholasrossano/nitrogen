"""Add provenance_traces table for Layer 1 audit logging

Revision ID: 014
Revises: 013
Create Date: 2026-03-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '014'
down_revision = '013'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'provenance_traces',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('initiative_id', postgresql.UUID(as_uuid=True),
                   sa.ForeignKey('initiatives.id', ondelete='CASCADE'), nullable=True, index=True),
        sa.Column('session_id', postgresql.UUID(as_uuid=True),
                   sa.ForeignKey('core_chat_sessions.id', ondelete='CASCADE'), nullable=True, index=True),
        sa.Column('trigger', sa.String(80), nullable=False),
        sa.Column('trigger_ref', sa.String(255), nullable=True),
        sa.Column('retrieval_context', postgresql.JSONB(), nullable=True),
        sa.Column('thinking_lines', postgresql.JSONB(), nullable=True),
        sa.Column('model_id', sa.String(100), nullable=True),
        sa.Column('prompt_template', sa.String(200), nullable=True),
        sa.Column('latency_ms', sa.Integer(), nullable=True),
        sa.Column('token_usage', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('provenance_traces')
