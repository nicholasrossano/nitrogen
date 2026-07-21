"""Rename investment_memo assessment id to memo.

The Investment Memo assessment was renamed to Memo and its proceed/hold/reject
recommendation mechanic removed (it now only summarizes risk and evidence, not
an investment decision). This data migration re-points existing rows at the
new "memo" assessment_id so pre-existing assessment instances, decision log
events, and variable bindings stay attached to the (renamed) assessment
definition. Also updates the assessment id inside variables.used_in_assessments
(a JSONB string array). Pre-launch: a hard rename, no dual-write/alias period
needed.

Revision ID: 072
Revises: 071
Create Date: 2026-07-21
"""

from collections.abc import Sequence

from alembic import op

revision: str = "072"
down_revision: str | None = "071"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("assessment_instances", "decision_events", "variable_bindings")


def _rename(old: str, new: str) -> None:
    for table in _TABLES:
        op.execute(
            f"UPDATE \"{table}\" SET assessment_id = '{new}' WHERE assessment_id = '{old}'"
        )
    op.execute(
        f"""
        UPDATE variables
        SET used_in_assessments = (
            SELECT jsonb_agg(
                CASE WHEN elem = '"{old}"'::jsonb THEN '"{new}"'::jsonb ELSE elem END
            )
            FROM jsonb_array_elements(used_in_assessments) AS elem
        )
        WHERE used_in_assessments @> '["{old}"]'::jsonb
        """
    )


def upgrade() -> None:
    _rename("investment_memo", "memo")


def downgrade() -> None:
    _rename("memo", "investment_memo")
