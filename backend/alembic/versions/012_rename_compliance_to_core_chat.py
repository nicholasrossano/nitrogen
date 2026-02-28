"""Rename compliance_chat_* tables to core_chat_*

Revision ID: 012
Revises: 011
Create Date: 2026-02-28
"""
from alembic import op

revision = '012'
down_revision = '011'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.rename_table('compliance_chat_sessions', 'core_chat_sessions')
    op.rename_table('compliance_chat_messages', 'core_chat_messages')

    # Rename indexes
    op.execute('ALTER INDEX ix_compliance_chat_sessions_user_id RENAME TO ix_core_chat_sessions_user_id')
    op.execute('ALTER INDEX ix_compliance_chat_messages_session_id RENAME TO ix_core_chat_messages_session_id')


def downgrade() -> None:
    op.execute('ALTER INDEX ix_core_chat_messages_session_id RENAME TO ix_compliance_chat_messages_session_id')
    op.execute('ALTER INDEX ix_core_chat_sessions_user_id RENAME TO ix_compliance_chat_sessions_user_id')

    op.rename_table('core_chat_messages', 'compliance_chat_messages')
    op.rename_table('core_chat_sessions', 'compliance_chat_sessions')
