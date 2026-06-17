"""Contract: merge initiatives into projects, drop legacy onboarding chat.

Revision ID: 061
Revises: 060
Create Date: 2026-06-17
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "061"
down_revision: str | None = "060"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PROJECT_CHILD_SPECS: dict[str, dict] = {
    "assumptions": {
        "nullable": False,
        "drop_indexes": ("ix_assumptions_initiative_key", "ix_assumptions_initiative_status"),
        "create_indexes": (
            ("ix_assumptions_project_key", ("project_id", "key")),
            ("ix_assumptions_project_status", ("project_id", "status")),
        ),
    },
    "assumption_comments": {
        "nullable": False,
        "drop_indexes": ("ix_assumption_comments_initiative_created",),
        "create_indexes": (("ix_assumption_comments_project_created", ("project_id", "created_at")),),
    },
    "assumption_bindings": {
        "nullable": False,
        "drop_indexes": ("ix_assumption_bindings_initiative_assessment_field",),
        "create_indexes": (
            ("ix_assumption_bindings_project_assessment_field", ("project_id", "assessment_id", "field_name")),
        ),
    },
    "assessment_instances": {
        "nullable": False,
        "drop_indexes": ("ix_mi_initiative_assessment", "ix_mi_initiative_chat"),
        "create_indexes": (
            ("ix_mi_project_assessment", ("project_id", "assessment_id")),
            ("ix_mi_project_chat", ("project_id", "chat_id")),
        ),
    },
    "project_health_results": {
        "nullable": False,
        "drop_indexes": ("ix_project_health_results_initiative_status",),
        "drop_constraints": ("uq_project_health_results_dimension",),
        "create_indexes": (("ix_project_health_results_project_status", ("project_id", "status")),),
        "create_unique": (("uq_project_health_results_project_dimension", ("project_id", "dimension_id")),),
    },
    "project_health_overrides": {
        "nullable": False,
        "drop_indexes": ("ix_project_health_overrides_initiative_dimension",),
        "create_indexes": (("ix_project_health_overrides_project_dimension", ("project_id", "dimension_id")),),
    },
    "evidence_docs": {"nullable": True, "drop_indexes": (), "create_indexes": ()},
    "decision_events": {
        "nullable": False,
        "drop_indexes": ("ix_decision_events_initiative_created",),
        "create_indexes": (("ix_decision_events_project_created", ("project_id", "created_at")),),
    },
    "project_materials": {"nullable": False, "drop_indexes": (), "create_indexes": ()},
    "project_shares": {
        "nullable": False,
        "drop_indexes": (),
        "drop_constraints": ("uq_project_shares_initiative_user",),
        "create_unique": (("uq_project_shares_project_user", ("project_id", "user_id")),),
    },
    "memo_versions": {"nullable": False, "drop_indexes": (), "create_indexes": ()},
    "provenance_traces": {"nullable": True, "drop_indexes": (), "create_indexes": ()},
    "drive_linked_files": {"nullable": False, "drop_indexes": (), "create_indexes": ()},
}


def _drop_initiative_fk(table: str, spec: dict) -> None:
    op.execute(
        f"""
        UPDATE {table}
        SET project_id = initiative_id
        WHERE project_id IS NULL AND initiative_id IS NOT NULL
        """
    )
    if not spec.get("nullable", False):
        op.alter_column(table, "project_id", nullable=False)

    for index_name in spec.get("drop_indexes", ()):
        op.drop_index(index_name, table_name=table, if_exists=True)

    for constraint_name in spec.get("drop_constraints", ()):
        op.drop_constraint(constraint_name, table, type_="unique", if_exists=True)

    op.drop_index(f"ix_{table}_initiative_id", table_name=table, if_exists=True)
    op.drop_constraint(f"{table}_initiative_id_fkey", table, type_="foreignkey", if_exists=True)
    op.drop_column(table, "initiative_id")

    for index_name, columns in spec.get("create_indexes", ()):
        op.create_index(index_name, table, list(columns))

    for constraint_name, columns in spec.get("create_unique", ()):
        op.create_unique_constraint(constraint_name, table, list(columns))


def upgrade() -> None:
    op.add_column("projects", sa.Column("project_type", sa.String(length=100), nullable=True))
    op.add_column("projects", sa.Column("icon", sa.String(length=50), nullable=True))
    op.add_column("projects", sa.Column("sector", sa.String(length=100), nullable=False, server_default="general"))
    op.add_column("projects", sa.Column("geography", sa.String(length=255), nullable=True))
    op.add_column("projects", sa.Column("target_population", sa.Text(), nullable=True))
    op.add_column("projects", sa.Column("goal", sa.Text(), nullable=True))
    op.add_column("projects", sa.Column("budget_range", sa.String(length=100), nullable=True))
    op.add_column("projects", sa.Column("timeline", sa.String(length=100), nullable=True))
    op.add_column("projects", sa.Column("constraints", postgresql.ARRAY(sa.Text()), nullable=True))
    op.add_column("projects", sa.Column("selected_tools", postgresql.ARRAY(sa.Text()), nullable=True))
    op.add_column("projects", sa.Column("tool_inputs", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("projects", sa.Column("tool_alignments", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("projects", sa.Column("deliverables", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("projects", sa.Column("project_plan", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("projects", sa.Column("overview_description", sa.Text(), nullable=True))
    op.add_column("projects", sa.Column("overview_generated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("projects", sa.Column("stage", sa.String(length=20), nullable=False, server_default="describe"))
    op.add_column(
        "projects",
        sa.Column("stage_1_complete", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "projects",
        sa.Column("evidence_ready", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    op.execute(
        """
        UPDATE projects p
        SET
            name = COALESCE(NULLIF(i.title, ''), p.name),
            subject = COALESCE(i.project_description, p.subject),
            project_type = i.project_type,
            icon = i.icon,
            sector = COALESCE(i.sector, 'general'),
            geography = i.geography,
            target_population = i.target_population,
            goal = i.goal,
            budget_range = i.budget_range,
            timeline = i.timeline,
            constraints = i.constraints,
            selected_tools = i.selected_tools,
            tool_inputs = i.tool_inputs,
            tool_alignments = i.tool_alignments,
            deliverables = i.deliverables,
            project_plan = i.project_plan,
            overview_description = i.overview_description,
            overview_generated_at = i.overview_generated_at,
            stage = COALESCE(i.stage, 'describe'),
            stage_1_complete = COALESCE(i.stage_1_complete, false),
            evidence_ready = COALESCE(i.evidence_ready, false),
            created_by = i.user_id,
            archived = i.archived,
            slug = COALESCE(NULLIF(i.slug, ''), p.slug),
            updated_at = GREATEST(p.updated_at, i.updated_at)
        FROM initiatives i
        WHERE p.id = i.id
        """
    )

    for table, spec in PROJECT_CHILD_SPECS.items():
        _drop_initiative_fk(table, spec)

    # Pending project share invitations
    op.add_column(
        "project_share_invitations",
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.execute(
        """
        UPDATE project_share_invitations
        SET project_id = initiative_id
        WHERE initiative_id IS NOT NULL
        """
    )
    op.alter_column("project_share_invitations", "project_id", nullable=False)
    op.drop_constraint(
        "uq_project_share_invitation_initiative_email",
        "project_share_invitations",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_project_share_invitation_project_email",
        "project_share_invitations",
        ["project_id", "email"],
    )
    op.drop_index("ix_project_share_invitations_initiative_id", table_name="project_share_invitations", if_exists=True)
    op.drop_constraint(
        "project_share_invitations_initiative_id_fkey",
        "project_share_invitations",
        type_="foreignkey",
        if_exists=True,
    )
    op.drop_column("project_share_invitations", "initiative_id")
    op.create_index("ix_project_share_invitations_project_id", "project_share_invitations", ["project_id"])

    # core_chats
    op.execute(
        """
        UPDATE core_chats
        SET project_id = initiative_id
        WHERE project_id IS NULL AND initiative_id IS NOT NULL
        """
    )
    op.drop_index("ix_core_chats_initiative_id", table_name="core_chats", if_exists=True)
    op.drop_constraint("core_chats_initiative_id_fkey", "core_chats", type_="foreignkey", if_exists=True)
    op.drop_column("core_chats", "initiative_id")
    op.alter_column(
        "core_chats",
        "compare_initiative_ids",
        new_column_name="compare_project_ids",
        existing_type=postgresql.JSONB(astext_type=sa.Text()),
        existing_nullable=True,
    )

    op.drop_index("ix_chat_messages_initiative_id", table_name="chat_messages", if_exists=True)
    op.drop_table("chat_messages")

    # Legacy tables that still FK initiatives but were not in the 060 expand set
    for table in (
        "gs_certification_workspaces",
        "pdd_workspaces",
        "client_invitations",
    ):
        op.add_column(
            table,
            sa.Column(
                "project_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("projects.id", ondelete="CASCADE"),
                nullable=True,
            ),
        )
        op.execute(
            f"""
            UPDATE {table}
            SET project_id = initiative_id
            WHERE initiative_id IS NOT NULL
            """
        )
        op.drop_index(f"ix_{table}_initiative_id", table_name=table, if_exists=True)
        op.drop_constraint(f"{table}_initiative_id_fkey", table, type_="foreignkey", if_exists=True)
        op.drop_column(table, "initiative_id")
        op.create_index(f"ix_{table}_project_id", table, ["project_id"])

    op.drop_index("ix_initiatives_user_id", table_name="initiatives", if_exists=True)
    op.drop_index("ix_initiatives_workspace_id", table_name="initiatives", if_exists=True)
    op.drop_index("ix_initiatives_archived", table_name="initiatives", if_exists=True)
    op.drop_table("initiatives")


def downgrade() -> None:
    raise NotImplementedError("061 contract migration is not reversible")
