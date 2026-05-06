"""Add persisted project health tables.

Revision ID: 057
Revises: 056
Create Date: 2026-05-06
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "057"
down_revision: str | None = "056"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "project_health_results",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("initiative_id", sa.UUID(), nullable=False),
        sa.Column("domain", sa.String(length=64), nullable=False),
        sa.Column("dimension_id", sa.String(length=120), nullable=False),
        sa.Column("dimension_label", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("confidence", sa.String(length=24), nullable=False, server_default="unknown"),
        sa.Column("rationale", sa.Text(), nullable=False, server_default=""),
        sa.Column("positive_drivers", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("negative_drivers", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("blockers", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("missing_items", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("relevant_modules", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("improvement_actions", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("uncertainties", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("supporting_signals", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("update_source", sa.String(length=64), nullable=False, server_default="manual_refresh"),
        sa.Column("source_fingerprint", sa.String(length=128), nullable=True),
        sa.Column("is_stale", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("last_updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["initiative_id"], ["initiatives.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("initiative_id", "dimension_id", name="uq_project_health_results_dimension"),
    )
    op.create_index(
        "ix_project_health_results_initiative_status",
        "project_health_results",
        ["initiative_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_project_health_results_is_stale",
        "project_health_results",
        ["is_stale"],
        unique=False,
    )

    op.create_table(
        "project_health_overrides",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("initiative_id", sa.UUID(), nullable=False),
        sa.Column("dimension_id", sa.String(length=120), nullable=False),
        sa.Column("prior_system_status", sa.String(length=24), nullable=True),
        sa.Column("override_status", sa.String(length=24), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("overridden_by_user_id", sa.String(length=255), nullable=False),
        sa.Column("overridden_by_email", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["initiative_id"], ["initiatives.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_project_health_overrides_initiative_dimension",
        "project_health_overrides",
        ["initiative_id", "dimension_id"],
        unique=False,
    )
    op.create_index(
        "ix_project_health_overrides_created_at",
        "project_health_overrides",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_project_health_overrides_created_at", table_name="project_health_overrides")
    op.drop_index("ix_project_health_overrides_initiative_dimension", table_name="project_health_overrides")
    op.drop_table("project_health_overrides")

    op.drop_index("ix_project_health_results_is_stale", table_name="project_health_results")
    op.drop_index("ix_project_health_results_initiative_status", table_name="project_health_results")
    op.drop_table("project_health_results")
