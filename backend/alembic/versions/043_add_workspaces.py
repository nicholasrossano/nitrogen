"""Add workspace ownership model.

Revision ID: 043
Revises: 042
Create Date: 2026-04-28
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "043"
down_revision = "042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspaces",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "workspace_type",
            sa.String(length=32),
            nullable=False,
            server_default="personal",
        ),
        sa.Column(
            "personal_owner_id",
            sa.String(length=255),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_workspaces_workspace_type", "workspaces", ["workspace_type"])
    op.create_index("ix_workspaces_personal_owner_id", "workspaces", ["personal_owner_id"], unique=True)

    op.create_table(
        "workspace_memberships",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "workspace_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(length=255),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(length=32), nullable=False, server_default="member"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("workspace_id", "user_id", name="uq_workspace_membership_user"),
    )
    op.create_index("ix_workspace_memberships_workspace_id", "workspace_memberships", ["workspace_id"])
    op.create_index("ix_workspace_memberships_user_id", "workspace_memberships", ["user_id"])

    op.add_column("initiatives", sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("ix_initiatives_workspace_id", "initiatives", ["workspace_id"])
    op.create_foreign_key(
        "fk_initiatives_workspace_id_workspaces",
        "initiatives",
        "workspaces",
        ["workspace_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.add_column("evidence_docs", sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("ix_evidence_docs_workspace_id", "evidence_docs", ["workspace_id"])
    op.create_foreign_key(
        "fk_evidence_docs_workspace_id_workspaces",
        "evidence_docs",
        "workspaces",
        ["workspace_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.alter_column("evidence_docs", "initiative_id", nullable=True)

    op.add_column("project_materials", sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("ix_project_materials_workspace_id", "project_materials", ["workspace_id"])
    op.create_foreign_key(
        "fk_project_materials_workspace_id_workspaces",
        "project_materials",
        "workspaces",
        ["workspace_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.add_column("drive_linked_files", sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("ix_drive_linked_files_workspace_id", "drive_linked_files", ["workspace_id"])
    op.create_foreign_key(
        "fk_drive_linked_files_workspace_id_workspaces",
        "drive_linked_files",
        "workspaces",
        ["workspace_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # Some older rows may predate the users table backfill. Create minimal user
    # records so every project owner can receive a personal workspace.
    op.execute(
        """
        INSERT INTO users (id, created_at, last_seen_at)
        SELECT DISTINCT i.user_id, now(), now()
        FROM initiatives i
        LEFT JOIN users u ON u.id = i.user_id
        WHERE u.id IS NULL
        """
    )
    op.execute(
        """
        INSERT INTO users (id, created_at, last_seen_at)
        SELECT DISTINCT ps.user_id, now(), now()
        FROM project_shares ps
        LEFT JOIN users u ON u.id = ps.user_id
        WHERE u.id IS NULL
        """
    )

    op.execute(
        """
        INSERT INTO workspaces (name, workspace_type, personal_owner_id, created_at, updated_at)
        SELECT 'Personal', 'personal', u.id, now(), now()
        FROM users u
        LEFT JOIN workspaces w ON w.personal_owner_id = u.id
        WHERE w.id IS NULL
        """
    )
    op.execute(
        """
        INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at, updated_at)
        SELECT w.id, w.personal_owner_id, 'owner', now(), now()
        FROM workspaces w
        LEFT JOIN workspace_memberships wm
            ON wm.workspace_id = w.id AND wm.user_id = w.personal_owner_id
        WHERE w.workspace_type = 'personal'
            AND w.personal_owner_id IS NOT NULL
            AND wm.id IS NULL
        """
    )
    op.execute(
        """
        UPDATE initiatives i
        SET workspace_id = w.id
        FROM workspaces w
        WHERE w.personal_owner_id = i.user_id
            AND i.workspace_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE evidence_docs e
        SET workspace_id = i.workspace_id
        FROM initiatives i
        WHERE e.initiative_id = i.id
            AND e.workspace_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE project_materials pm
        SET workspace_id = i.workspace_id
        FROM initiatives i
        WHERE pm.initiative_id = i.id
            AND pm.workspace_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE drive_linked_files d
        SET workspace_id = i.workspace_id
        FROM initiatives i
        WHERE d.initiative_id = i.id
            AND d.workspace_id IS NULL
        """
    )

    op.alter_column("initiatives", "workspace_id", nullable=False)
    op.alter_column("evidence_docs", "workspace_id", nullable=False)
    op.alter_column("project_materials", "workspace_id", nullable=False)
    op.alter_column("drive_linked_files", "workspace_id", nullable=False)
    op.create_check_constraint(
        "ck_evidence_docs_scope",
        "evidence_docs",
        "workspace_id IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_constraint("ck_evidence_docs_scope", "evidence_docs", type_="check")
    op.alter_column("drive_linked_files", "workspace_id", nullable=True)
    op.alter_column("project_materials", "workspace_id", nullable=True)
    op.alter_column("evidence_docs", "workspace_id", nullable=True)
    op.alter_column("initiatives", "workspace_id", nullable=True)

    op.drop_constraint("fk_drive_linked_files_workspace_id_workspaces", "drive_linked_files", type_="foreignkey")
    op.drop_index("ix_drive_linked_files_workspace_id", table_name="drive_linked_files")
    op.drop_column("drive_linked_files", "workspace_id")

    op.drop_constraint("fk_project_materials_workspace_id_workspaces", "project_materials", type_="foreignkey")
    op.drop_index("ix_project_materials_workspace_id", table_name="project_materials")
    op.drop_column("project_materials", "workspace_id")

    op.drop_constraint("fk_evidence_docs_workspace_id_workspaces", "evidence_docs", type_="foreignkey")
    op.drop_index("ix_evidence_docs_workspace_id", table_name="evidence_docs")
    op.drop_column("evidence_docs", "workspace_id")
    op.alter_column("evidence_docs", "initiative_id", nullable=False)

    op.drop_constraint("fk_initiatives_workspace_id_workspaces", "initiatives", type_="foreignkey")
    op.drop_index("ix_initiatives_workspace_id", table_name="initiatives")
    op.drop_column("initiatives", "workspace_id")

    op.drop_index("ix_workspace_memberships_user_id", table_name="workspace_memberships")
    op.drop_index("ix_workspace_memberships_workspace_id", table_name="workspace_memberships")
    op.drop_table("workspace_memberships")

    op.drop_index("ix_workspaces_personal_owner_id", table_name="workspaces")
    op.drop_index("ix_workspaces_workspace_type", table_name="workspaces")
    op.drop_table("workspaces")
