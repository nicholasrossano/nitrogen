"""Add agent loop status columns to assessment instances.

Revision ID: 058
Revises: 057
Create Date: 2026-05-06
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "058"
down_revision: str | None = "057"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _table_columns(inspector: sa.Inspector, table_name: str) -> set[str]:
    try:
        return {c["name"] for c in inspector.get_columns(table_name)}
    except Exception:
        return set()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = _table_columns(inspector, "assessment_instances")

    if "agent_loop_state" not in columns:
        op.add_column(
            "assessment_instances",
            sa.Column("agent_loop_state", sa.String(length=32), nullable=False, server_default="idle"),
        )
        op.alter_column("assessment_instances", "agent_loop_state", server_default=None)

    if "agent_current_action" not in columns:
        op.add_column(
            "assessment_instances",
            sa.Column("agent_current_action", sa.String(length=255), nullable=True),
        )

    if "agent_last_summary" not in columns:
        op.add_column(
            "assessment_instances",
            sa.Column("agent_last_summary", sa.String(length=500), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = _table_columns(inspector, "assessment_instances")

    if "agent_last_summary" in columns:
        op.drop_column("assessment_instances", "agent_last_summary")
    if "agent_current_action" in columns:
        op.drop_column("assessment_instances", "agent_current_action")
    if "agent_loop_state" in columns:
        op.drop_column("assessment_instances", "agent_loop_state")
