"""Add assumption comments table.

Revision ID: 046
Revises: 045
Create Date: 2026-04-30
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "046"
down_revision: str | None = "045"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assumption_comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "assumption_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assumptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "initiative_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("initiatives.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", sa.String(length=255), nullable=True),
        sa.Column("created_by_email", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_assumption_comments_assumption_created",
        "assumption_comments",
        ["assumption_id", "created_at"],
    )
    op.create_index(
        "ix_assumption_comments_initiative_created",
        "assumption_comments",
        ["initiative_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_assumption_comments_initiative_created", table_name="assumption_comments")
    op.drop_index("ix_assumption_comments_assumption_created", table_name="assumption_comments")
    op.drop_table("assumption_comments")
