"""Add attachments column to core_chat_messages.

Lets a chat message reference files (project_materials rows) that were
attached via the composer paperclip, so the chat UI can render a persistent
thumbnail/chip for them across reloads. Expand-only: nullable, no backfill
needed since no message previously had attachments.

Revision ID: 073
Revises: 072
Create Date: 2026-07-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "073"
down_revision: str | None = "072"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "core_chat_messages",
        sa.Column("attachments", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("core_chat_messages", "attachments")
