"""Add compliance_chat_sessions and compliance_chat_messages tables

Revision ID: 011
Revises: 010
Create Date: 2026-02-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '011'
down_revision = '010'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'compliance_chat_sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', sa.String(128), nullable=False),
        sa.Column('title', sa.String(200), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('ix_compliance_chat_sessions_user_id', 'compliance_chat_sessions', ['user_id'])

    op.create_table(
        'compliance_chat_messages',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('session_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('compliance_chat_sessions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(20), nullable=False),
        sa.Column('content', sa.Text, nullable=False),
        sa.Column('sources', postgresql.JSONB, nullable=True),
        sa.Column('thinking_lines', postgresql.JSONB, nullable=True),
        sa.Column('completion_meta', postgresql.JSONB, nullable=True),
        sa.Column('widget_type', sa.String(50), nullable=True),
        sa.Column('widget_data', postgresql.JSONB, nullable=True),
        sa.Column('feedback', sa.String(20), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_compliance_chat_messages_session_id', 'compliance_chat_messages', ['session_id'])


def downgrade() -> None:
    op.drop_table('compliance_chat_messages')
    op.drop_table('compliance_chat_sessions')
