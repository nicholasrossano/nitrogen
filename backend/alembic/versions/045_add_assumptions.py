"""Add project assumptions table.

Revision ID: 045
Revises: 044
Create Date: 2026-04-30
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "045"
down_revision: str | None = "044"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assumptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "initiative_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("initiatives.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.String(length=160), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("unit", sa.String(length=80), nullable=True),
        sa.Column("value_type", sa.String(length=40), nullable=False),
        sa.Column("source_type", sa.String(length=80), nullable=False),
        sa.Column("source_reference", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="needs_review"),
        sa.Column("used_in_modules", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("created_by_user_id", sa.String(length=255), nullable=True),
        sa.Column("created_by_email", sa.String(length=255), nullable=True),
        sa.Column("last_updated_by_user_id", sa.String(length=255), nullable=True),
        sa.Column("last_updated_by_email", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_assumptions_initiative_key", "assumptions", ["initiative_id", "key"])
    op.create_index("ix_assumptions_initiative_status", "assumptions", ["initiative_id", "status"])
    op.create_index("ix_assumptions_source_type", "assumptions", ["source_type"])


def downgrade() -> None:
    op.drop_index("ix_assumptions_source_type", table_name="assumptions")
    op.drop_index("ix_assumptions_initiative_status", table_name="assumptions")
    op.drop_index("ix_assumptions_initiative_key", table_name="assumptions")
    op.drop_table("assumptions")
