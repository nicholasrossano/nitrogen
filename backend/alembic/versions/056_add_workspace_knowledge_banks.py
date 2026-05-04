"""Add workspace knowledge bank tables.

Revision ID: 056
Revises: 055
Create Date: 2026-05-04
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector


# revision identifiers, used by Alembic.
revision: str = "056"
down_revision: str | None = "055"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workspace_knowledge_banks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("workspace_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("base_url", sa.String(length=2048), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("last_indexed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("index_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_workspace_knowledge_banks_workspace_id",
        "workspace_knowledge_banks",
        ["workspace_id"],
        unique=False,
    )
    op.create_index(
        "ix_workspace_knowledge_banks_status",
        "workspace_knowledge_banks",
        ["status"],
        unique=False,
    )

    op.create_table(
        "workspace_knowledge_chunks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("knowledge_bank_id", sa.UUID(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("source_title", sa.String(length=1024), nullable=False),
        sa.Column("source_url", sa.String(length=2048), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("embedding", Vector(1536), nullable=True),
        sa.ForeignKeyConstraint(["knowledge_bank_id"], ["workspace_knowledge_banks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_workspace_knowledge_chunks_knowledge_bank_id",
        "workspace_knowledge_chunks",
        ["knowledge_bank_id"],
        unique=False,
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_workspace_knowledge_chunks_embedding
        ON workspace_knowledge_chunks
        USING ivfflat (embedding vector_cosine_ops)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_workspace_knowledge_chunks_embedding")
    op.drop_index("ix_workspace_knowledge_chunks_knowledge_bank_id", table_name="workspace_knowledge_chunks")
    op.drop_table("workspace_knowledge_chunks")
    op.drop_index("ix_workspace_knowledge_banks_status", table_name="workspace_knowledge_banks")
    op.drop_index("ix_workspace_knowledge_banks_workspace_id", table_name="workspace_knowledge_banks")
    op.drop_table("workspace_knowledge_banks")
