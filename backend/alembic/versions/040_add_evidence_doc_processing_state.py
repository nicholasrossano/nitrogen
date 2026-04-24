"""Add evidence doc processing lifecycle columns.

Adds per-document processing state so we can distinguish between uploaded
(stored but not yet processed), lightweight_ready (minimal signal extracted —
safe to drive onboarding), indexed (fully chunked + embedded), and failed.

This replaces reliance on ``Initiative.evidence_ready`` as the single signal
of "documents are usable".

Revision ID: 040
Revises: 039
Create Date: 2026-04-24
"""

from alembic import op
import sqlalchemy as sa


revision = "040"
down_revision = "039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "evidence_docs",
        sa.Column(
            "processing_status",
            sa.String(length=32),
            nullable=False,
            server_default="uploaded",
        ),
    )
    op.add_column(
        "evidence_docs",
        sa.Column("processing_error", sa.Text(), nullable=True),
    )
    op.add_column(
        "evidence_docs",
        sa.Column(
            "processing_attempts",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "evidence_docs",
        sa.Column(
            "processing_started_at", sa.DateTime(timezone=True), nullable=True
        ),
    )
    op.add_column(
        "evidence_docs",
        sa.Column(
            "processing_completed_at", sa.DateTime(timezone=True), nullable=True
        ),
    )
    op.add_column(
        "evidence_docs",
        sa.Column("preview_text", sa.Text(), nullable=True),
    )
    op.create_index(
        "ix_evidence_docs_processing_status",
        "evidence_docs",
        ["processing_status"],
        unique=False,
    )

    # Backfill existing rows.  Any doc that already has chunks is effectively
    # indexed; rows without chunks (shouldn't normally exist, but be defensive)
    # are treated as uploaded.
    op.execute(
        """
        UPDATE evidence_docs
        SET processing_status = 'indexed'
        WHERE id IN (
            SELECT DISTINCT evidence_doc_id FROM evidence_chunks
        )
        """
    )


def downgrade() -> None:
    op.drop_index(
        "ix_evidence_docs_processing_status", table_name="evidence_docs"
    )
    op.drop_column("evidence_docs", "preview_text")
    op.drop_column("evidence_docs", "processing_completed_at")
    op.drop_column("evidence_docs", "processing_started_at")
    op.drop_column("evidence_docs", "processing_attempts")
    op.drop_column("evidence_docs", "processing_error")
    op.drop_column("evidence_docs", "processing_status")
