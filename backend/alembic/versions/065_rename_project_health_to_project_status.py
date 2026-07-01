"""Rename project health tables to project status and add category config.

Revision ID: 065
Revises: 064
Create Date: 2026-06-22
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "065"
down_revision: str | None = "064"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Rename results table and columns
    op.rename_table("project_health_results", "project_status_results")
    op.alter_column("project_status_results", "dimension_id", new_column_name="category_key")
    op.alter_column("project_status_results", "dimension_label", new_column_name="category_label")
    op.drop_constraint("uq_project_health_results_project_dimension", "project_status_results", type_="unique")
    op.create_unique_constraint(
        "uq_project_status_results_project_category",
        "project_status_results",
        ["project_id", "category_key"],
    )
    op.drop_index("ix_project_health_results_project_status", table_name="project_status_results")
    op.create_index(
        "ix_project_status_results_project_status",
        "project_status_results",
        ["project_id", "status"],
        unique=False,
    )
    op.drop_index("ix_project_health_results_is_stale", table_name="project_status_results")
    op.create_index("ix_project_status_results_is_stale", "project_status_results", ["is_stale"], unique=False)

    # Rename overrides table and columns
    op.rename_table("project_health_overrides", "project_status_overrides")
    op.alter_column("project_status_overrides", "dimension_id", new_column_name="category_key")
    op.drop_index("ix_project_health_overrides_project_dimension", table_name="project_status_overrides")
    op.create_index(
        "ix_project_status_overrides_project_category",
        "project_status_overrides",
        ["project_id", "category_key"],
        unique=False,
    )
    op.drop_index("ix_project_health_overrides_created_at", table_name="project_status_overrides")
    op.create_index(
        "ix_project_status_overrides_created_at",
        "project_status_overrides",
        ["created_at"],
        unique=False,
    )

    op.create_table(
        "project_status_categories",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("category_key", sa.String(length=120), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("definition_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("criteria", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "category_key", name="uq_project_status_categories_project_key"),
    )
    op.create_index(
        "ix_project_status_categories_project_active",
        "project_status_categories",
        ["project_id", "is_active"],
        unique=False,
    )

    op.create_table(
        "project_status_assessment_history",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("category_key", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("confidence", sa.String(length=24), nullable=False, server_default="unknown"),
        sa.Column("critical_insight", sa.Text(), nullable=False, server_default=""),
        sa.Column("source_fingerprint", sa.String(length=128), nullable=True),
        sa.Column("assessed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_project_status_assessment_history_project_category",
        "project_status_assessment_history",
        ["project_id", "category_key"],
        unique=False,
    )
    op.create_index(
        "ix_project_status_assessment_history_assessed_at",
        "project_status_assessment_history",
        ["assessed_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_project_status_assessment_history_assessed_at", table_name="project_status_assessment_history")
    op.drop_index(
        "ix_project_status_assessment_history_project_category",
        table_name="project_status_assessment_history",
    )
    op.drop_table("project_status_assessment_history")

    op.drop_index("ix_project_status_categories_project_active", table_name="project_status_categories")
    op.drop_table("project_status_categories")

    op.drop_index("ix_project_status_overrides_created_at", table_name="project_status_overrides")
    op.create_index(
        "ix_project_health_overrides_created_at",
        "project_status_overrides",
        ["created_at"],
        unique=False,
    )
    op.drop_index("ix_project_status_overrides_project_category", table_name="project_status_overrides")
    op.create_index(
        "ix_project_health_overrides_project_dimension",
        "project_status_overrides",
        ["project_id", "category_key"],
        unique=False,
    )
    op.alter_column("project_status_overrides", "category_key", new_column_name="dimension_id")
    op.rename_table("project_status_overrides", "project_health_overrides")

    op.drop_index("ix_project_status_results_is_stale", table_name="project_status_results")
    op.create_index("ix_project_health_results_is_stale", "project_status_results", ["is_stale"], unique=False)
    op.drop_index("ix_project_status_results_project_status", table_name="project_status_results")
    op.create_index(
        "ix_project_health_results_project_status",
        "project_status_results",
        ["project_id", "status"],
        unique=False,
    )
    op.drop_constraint("uq_project_status_results_project_category", "project_status_results", type_="unique")
    op.create_unique_constraint(
        "uq_project_health_results_project_dimension",
        "project_status_results",
        ["project_id", "category_key"],
    )
    op.alter_column("project_status_results", "category_label", new_column_name="dimension_label")
    op.alter_column("project_status_results", "category_key", new_column_name="dimension_id")
    op.rename_table("project_status_results", "project_health_results")
