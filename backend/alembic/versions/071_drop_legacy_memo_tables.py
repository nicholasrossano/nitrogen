"""Drop legacy memo_versions/citations tables.

The pre-launch legacy memo-generation flow (MemoGeneratorService,
MemoGenerationAdapter, MemoViewerWidget) is unreachable from any current
user action — memos are now produced by the staged
memo assessment and exported via generate_assessment_docx into
project Files (ProjectMaterial). No code writes to these tables anymore.

Revision ID: 071
Revises: 070
Create Date: 2026-07-21
"""

from collections.abc import Sequence

from alembic import op

revision: str = "071"
down_revision: str | None = "070"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("citations")
    op.drop_table("memo_versions")


def downgrade() -> None:
    import sqlalchemy as sa
    from sqlalchemy.dialects import postgresql

    op.create_table(
        "memo_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("export_path", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_table(
        "citations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "memo_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("memo_versions.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("section_name", sa.String(length=100), nullable=True),
        sa.Column("citation_number", sa.Integer(), nullable=False),
        sa.Column("chunk_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_type", sa.String(length=20), nullable=False, server_default="evidence"),
        sa.Column("excerpt", sa.Text(), nullable=True),
    )
