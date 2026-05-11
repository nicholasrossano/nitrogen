"""Add pending invitations for workspace members and project shares.

Revision ID: 059
Revises: 058
Create Date: 2026-05-11
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "059"
down_revision: str | None = "058"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workspace_invitations",
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
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False, server_default="member"),
        sa.Column(
            "invited_by",
            sa.String(length=255),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("workspace_id", "email", name="uq_workspace_invitation_workspace_email"),
    )
    op.create_index("ix_workspace_invitations_workspace_id", "workspace_invitations", ["workspace_id"])
    op.create_index("ix_workspace_invitations_email", "workspace_invitations", ["email"])

    op.create_table(
        "project_share_invitations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "initiative_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("initiatives.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column(
            "shared_by",
            sa.String(length=255),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("initiative_id", "email", name="uq_project_share_invitation_initiative_email"),
    )
    op.create_index(
        "ix_project_share_invitations_initiative_id",
        "project_share_invitations",
        ["initiative_id"],
    )
    op.create_index("ix_project_share_invitations_email", "project_share_invitations", ["email"])


def downgrade() -> None:
    op.drop_index("ix_project_share_invitations_email", table_name="project_share_invitations")
    op.drop_index("ix_project_share_invitations_initiative_id", table_name="project_share_invitations")
    op.drop_table("project_share_invitations")

    op.drop_index("ix_workspace_invitations_email", table_name="workspace_invitations")
    op.drop_index("ix_workspace_invitations_workspace_id", table_name="workspace_invitations")
    op.drop_table("workspace_invitations")
