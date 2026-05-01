"""Rename core chat session terminology to chat terminology.

Revision ID: 038
Revises: 037
Create Date: 2026-04-16
"""

from alembic import op


revision = "038"
down_revision = "037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.rename_table("core_chat_sessions", "core_chats")

    op.alter_column("core_chat_messages", "session_id", new_column_name="chat_id")
    op.alter_column("assessment_instances", "session_id", new_column_name="chat_id")
    op.alter_column("provenance_traces", "session_id", new_column_name="chat_id")

    op.execute(
        "ALTER TABLE core_chats RENAME CONSTRAINT fk_core_chat_sessions_initiative_id TO fk_core_chats_initiative_id"
    )
    op.execute(
        "ALTER INDEX IF EXISTS ix_core_chat_sessions_user_id RENAME TO ix_core_chats_user_id"
    )
    op.execute(
        "ALTER INDEX IF EXISTS ix_core_chat_sessions_initiative_id RENAME TO ix_core_chats_initiative_id"
    )
    op.execute(
        "ALTER INDEX IF EXISTS ix_core_chat_messages_session_id RENAME TO ix_core_chat_messages_chat_id"
    )
    op.execute(
        "ALTER INDEX IF EXISTS ix_mi_initiative_session RENAME TO ix_mi_initiative_chat"
    )
    op.execute(
        "ALTER INDEX IF EXISTS ix_provenance_traces_session_id RENAME TO ix_provenance_traces_chat_id"
    )


def downgrade() -> None:
    op.execute(
        "ALTER INDEX IF EXISTS ix_provenance_traces_chat_id RENAME TO ix_provenance_traces_session_id"
    )
    op.execute(
        "ALTER INDEX IF EXISTS ix_mi_initiative_chat RENAME TO ix_mi_initiative_session"
    )
    op.execute(
        "ALTER INDEX IF EXISTS ix_core_chat_messages_chat_id RENAME TO ix_core_chat_messages_session_id"
    )
    op.execute(
        "ALTER INDEX IF EXISTS ix_core_chats_initiative_id RENAME TO ix_core_chat_sessions_initiative_id"
    )
    op.execute(
        "ALTER INDEX IF EXISTS ix_core_chats_user_id RENAME TO ix_core_chat_sessions_user_id"
    )
    op.execute(
        "ALTER TABLE core_chats RENAME CONSTRAINT fk_core_chats_initiative_id TO fk_core_chat_sessions_initiative_id"
    )

    op.alter_column("provenance_traces", "chat_id", new_column_name="session_id")
    op.alter_column("assessment_instances", "chat_id", new_column_name="session_id")
    op.alter_column("core_chat_messages", "chat_id", new_column_name="session_id")

    op.rename_table("core_chats", "core_chat_sessions")
