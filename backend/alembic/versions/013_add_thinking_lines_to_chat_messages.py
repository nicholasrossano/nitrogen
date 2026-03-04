"""Add thinking_lines and completion_meta to chat_messages for initiative chat parity

Revision ID: 013
Revises: 012
Create Date: 2026-03-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '013'
down_revision = '012'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('chat_messages', sa.Column('thinking_lines', postgresql.JSONB(), nullable=True))
    op.add_column('chat_messages', sa.Column('completion_meta', postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column('chat_messages', 'completion_meta')
    op.drop_column('chat_messages', 'thinking_lines')
