"""Add decision events and workflow versioning.

Revision ID: 039
Revises: 038
Create Date: 2026-04-17
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "039"
down_revision = "038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "assessment_instances",
        sa.Column("workflow_version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.alter_column("assessment_instances", "workflow_version", server_default=None)

    op.create_table(
        "decision_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("initiative_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("assessment_instance_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("assessment_id", sa.String(length=100), nullable=False),
        sa.Column("stage_id", sa.String(length=100), nullable=True),
        sa.Column("entity_type", sa.String(length=50), nullable=False),
        sa.Column("entity_id", sa.String(length=255), nullable=True),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("actor_user_id", sa.String(length=255), nullable=True),
        sa.Column("actor_email", sa.String(length=255), nullable=True),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column("payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["initiative_id"], ["initiatives.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assessment_instance_id"], ["assessment_instances.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_decision_events_initiative_created",
        "decision_events",
        ["initiative_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_decision_events_instance_created",
        "decision_events",
        ["assessment_instance_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_decision_events_event_type",
        "decision_events",
        ["event_type"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_decision_events_event_type", table_name="decision_events")
    op.drop_index("ix_decision_events_instance_created", table_name="decision_events")
    op.drop_index("ix_decision_events_initiative_created", table_name="decision_events")
    op.drop_table("decision_events")
    op.drop_column("assessment_instances", "workflow_version")
