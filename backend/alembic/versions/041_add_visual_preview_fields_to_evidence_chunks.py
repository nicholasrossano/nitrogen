"""Add visual preview fields to evidence chunks.

Revision ID: 041
Revises: 040
Create Date: 2026-04-27
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "041"
down_revision = "040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "evidence_chunks",
        sa.Column(
            "chunk_kind",
            sa.String(length=32),
            nullable=False,
            server_default="text",
        ),
    )
    op.add_column(
        "evidence_chunks",
        sa.Column("bbox", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "evidence_chunks",
        sa.Column("preview_image_path", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "evidence_chunks",
        sa.Column("preview_mime_type", sa.String(length=100), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("evidence_chunks", "preview_mime_type")
    op.drop_column("evidence_chunks", "preview_image_path")
    op.drop_column("evidence_chunks", "bbox")
    op.drop_column("evidence_chunks", "chunk_kind")
