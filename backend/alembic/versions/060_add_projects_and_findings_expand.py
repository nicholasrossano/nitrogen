"""Expand: projects + findings tables, nullable project_id backfill from initiatives.

Revision ID: 060
Revises: 059
Create Date: 2026-06-17
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "060"
down_revision: str | None = "059"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PROJECT_CHILD_TABLES = (
    "assumptions",
    "assumption_comments",
    "assumption_bindings",
    "assessment_instances",
    "project_health_results",
    "project_health_overrides",
    "evidence_docs",
    "decision_events",
    "project_materials",
    "project_shares",
    "memo_versions",
    "provenance_traces",
    "drive_linked_files",
    "chat_messages",
)


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "workspace_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("subject", sa.Text(), nullable=True),
        sa.Column("slug", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("created_by", sa.String(length=255), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_projects_workspace_id", "projects", ["workspace_id"])
    op.create_index("ix_projects_created_by", "projects", ["created_by"])
    op.create_index("ix_projects_archived", "projects", ["archived"])

    op.create_table(
        "findings",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("sources", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("promoted_by", sa.String(length=255), nullable=False),
        sa.Column(
            "source_chat_message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("core_chat_messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="published"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_findings_project_id", "findings", ["project_id"])
    op.create_index("ix_findings_promoted_by", "findings", ["promoted_by"])

    for table in PROJECT_CHILD_TABLES:
        op.add_column(
            table,
            sa.Column(
                "project_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("projects.id", ondelete="CASCADE"),
                nullable=True,
            ),
        )
        op.create_index(f"ix_{table}_project_id", table, ["project_id"])

    op.add_column(
        "core_chats",
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_core_chats_project_id", "core_chats", ["project_id"])

    op.add_column(
        "core_chats",
        sa.Column(
            "workspace_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_core_chats_workspace_id", "core_chats", ["workspace_id"])

    # 1:1 backfill projects from initiatives (reuse UUID)
    op.execute(
        """
        INSERT INTO projects (id, workspace_id, name, subject, slug, created_by, archived, created_at, updated_at)
        SELECT
            id,
            workspace_id,
            COALESCE(NULLIF(title, ''), 'New Project'),
            project_description,
            slug,
            user_id,
            archived,
            created_at,
            updated_at
        FROM initiatives
        """
    )

    for table in PROJECT_CHILD_TABLES:
        op.execute(
            f"""
            UPDATE {table}
            SET project_id = initiative_id
            WHERE initiative_id IS NOT NULL
            """
        )

    op.execute(
        """
        UPDATE core_chats c
        SET project_id = c.initiative_id,
            workspace_id = i.workspace_id
        FROM initiatives i
        WHERE c.initiative_id = i.id
        """
    )


def downgrade() -> None:
    op.drop_index("ix_core_chats_workspace_id", table_name="core_chats")
    op.drop_column("core_chats", "workspace_id")
    op.drop_index("ix_core_chats_project_id", table_name="core_chats")
    op.drop_column("core_chats", "project_id")

    for table in reversed(PROJECT_CHILD_TABLES):
        op.drop_index(f"ix_{table}_project_id", table_name=table)
        op.drop_column(table, "project_id")

    op.drop_index("ix_findings_promoted_by", table_name="findings")
    op.drop_index("ix_findings_project_id", table_name="findings")
    op.drop_table("findings")

    op.drop_index("ix_projects_archived", table_name="projects")
    op.drop_index("ix_projects_created_by", table_name="projects")
    op.drop_index("ix_projects_workspace_id", table_name="projects")
    op.drop_table("projects")
