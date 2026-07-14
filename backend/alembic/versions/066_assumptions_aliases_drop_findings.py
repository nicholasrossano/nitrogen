"""Add assumptions.aliases and drop unused findings table.

Revision ID: 066
Revises: 065
Create Date: 2026-07-14

Findings promotion was retired: shared analyses are approved assessment
instances; reusable values live only on assumptions. Local/staging/prod
findings counts were verified empty (or archived privately) before this
contract drop. expands assumptions with nullable aliases for fuzzy de-dup.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "066"
down_revision: str | None = "065"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "assumptions",
        sa.Column("aliases", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.drop_table("findings")


def downgrade() -> None:
    op.create_table(
        "findings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("sources", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("promoted_by", sa.String(length=255), nullable=False, index=True),
        sa.Column(
            "source_chat_message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_chat_messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="published"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.drop_column("assumptions", "aliases")
