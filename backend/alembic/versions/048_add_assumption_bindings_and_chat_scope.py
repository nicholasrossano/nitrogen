"""Add assumption bindings and assumption-scoped chats.

Revision ID: 048
Revises: 047
Create Date: 2026-05-01
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "048"
down_revision: str | None = "047"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assumption_bindings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "initiative_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("initiatives.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "assumption_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assumptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("module_id", sa.String(length=160), nullable=False),
        sa.Column(
            "module_instance_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("module_instances.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("stage_id", sa.String(length=120), nullable=True),
        sa.Column("field_name", sa.String(length=160), nullable=False),
        sa.Column("field_label", sa.String(length=255), nullable=True),
        sa.Column("unit", sa.String(length=80), nullable=True),
        sa.Column("value_type", sa.String(length=40), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_assumption_bindings_initiative_module_field",
        "assumption_bindings",
        ["initiative_id", "module_id", "field_name"],
    )
    op.create_index(
        "ix_assumption_bindings_assumption",
        "assumption_bindings",
        ["assumption_id"],
    )
    op.create_index(
        "ix_assumption_bindings_module_instance",
        "assumption_bindings",
        ["module_instance_id"],
    )

    op.add_column("core_chats", sa.Column("assumption_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_core_chats_assumption_id",
        "core_chats",
        "assumptions",
        ["assumption_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_core_chats_assumption_id", "core_chats", ["assumption_id"])


def downgrade() -> None:
    op.drop_index("ix_core_chats_assumption_id", table_name="core_chats")
    op.drop_constraint("fk_core_chats_assumption_id", "core_chats", type_="foreignkey")
    op.drop_column("core_chats", "assumption_id")

    op.drop_index("ix_assumption_bindings_module_instance", table_name="assumption_bindings")
    op.drop_index("ix_assumption_bindings_assumption", table_name="assumption_bindings")
    op.drop_index("ix_assumption_bindings_initiative_module_field", table_name="assumption_bindings")
    op.drop_table("assumption_bindings")
