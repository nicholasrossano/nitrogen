"""Add module_instances table and backfill from deliverables/tool_alignments

Revision ID: 030
Revises: 029
Create Date: 2026-03-27

"""
import json
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '030'
down_revision = '029'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'module_instances',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('initiative_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('initiatives.id', ondelete='CASCADE'), nullable=False),
        sa.Column('tool_id', sa.String(100), nullable=False),
        sa.Column('status', sa.String(50), nullable=False, server_default='started'),
        sa.Column('title', sa.String(255), nullable=True),
        sa.Column('started_by', sa.String(255), nullable=False),
        sa.Column('session_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('core_chat_sessions.id', ondelete='SET NULL'), nullable=True),
        sa.Column('alignment', postgresql.JSONB, nullable=True),
        sa.Column('deliverable', postgresql.JSONB, nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
    )

    op.create_index('ix_mi_initiative_tool', 'module_instances',
                    ['initiative_id', 'tool_id'])
    op.create_index('ix_mi_initiative_session', 'module_instances',
                    ['initiative_id', 'session_id'])

    # Backfill from existing initiative data.
    # One instance per deliverable key (status=complete), then one per
    # tool_alignment key that wasn't already covered (status depends on
    # the confirmed flag).
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT id, user_id, deliverables, tool_alignments, updated_at "
        "FROM initiatives"
    ))

    for row in rows:
        init_id = row.id
        user_id = row.user_id
        ts = row.updated_at
        deliverables = row.deliverables or {}
        alignments = row.tool_alignments or {}

        covered_tools = set()

        for tool_id, data in deliverables.items():
            covered_tools.add(tool_id)
            alignment_data = alignments.get(tool_id)
            conn.execute(sa.text(
                "INSERT INTO module_instances "
                "(initiative_id, tool_id, status, title, started_by, "
                " alignment, deliverable, started_at, updated_at) "
                "VALUES (:iid, :tid, 'complete', :title, :uid, "
                "        CAST(:alignment AS jsonb), CAST(:deliverable AS jsonb), :ts, :ts)"
            ), {
                "iid": init_id,
                "tid": tool_id,
                "title": data.get("title") if isinstance(data, dict) else None,
                "uid": user_id,
                "alignment": json.dumps(alignment_data) if alignment_data is not None else None,
                "deliverable": json.dumps(data),
                "ts": ts,
            })

        for tool_id, data in alignments.items():
            if tool_id in covered_tools:
                continue
            confirmed = data.get("confirmed", False) if isinstance(data, dict) else False
            status = "alignment_confirmed" if confirmed else "alignment_proposed"
            conn.execute(sa.text(
                "INSERT INTO module_instances "
                "(initiative_id, tool_id, status, started_by, "
                " alignment, started_at, updated_at) "
                "VALUES (:iid, :tid, :status, :uid, CAST(:alignment AS jsonb), :ts, :ts)"
            ), {
                "iid": init_id,
                "tid": tool_id,
                "status": status,
                "uid": user_id,
                "alignment": json.dumps(data),
                "ts": ts,
            })


def downgrade():
    op.drop_index('ix_mi_initiative_session', table_name='module_instances')
    op.drop_index('ix_mi_initiative_tool', table_name='module_instances')
    op.drop_table('module_instances')
