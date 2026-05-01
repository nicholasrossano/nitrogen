"""Bump ``initiatives.updated_at`` when project-linked rows change.

The project grid orders by ``updated_at``; child-table writes do not otherwise
touch the parent initiative row, so we issue a targeted UPDATE from ORM events.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import event, select, update

from app.models.initiative import Initiative


def _bump_initiative_ts(connection, initiative_id: uuid.UUID | None) -> None:
    if initiative_id is None:
        return
    now = datetime.now(timezone.utc)
    connection.execute(
        update(Initiative)
        .where(Initiative.id == initiative_id)
        .values(updated_at=now)
    )


def _register_child_listeners() -> None:
    from app.models.assessment_instance import AssessmentInstance
    from app.models.onboarding import ChatMessage
    from app.models.chat import CoreChat, CoreChatMessage
    from app.models.evidence import EvidenceDoc, EvidenceChunk
    from app.models.project_material import ProjectMaterial
    from app.models.memo import MemoVersion

    def bump_from_assessment(mapper, connection, target):
        _bump_initiative_ts(connection, target.initiative_id)

    event.listen(AssessmentInstance, "after_insert", bump_from_assessment, propagate=True)
    event.listen(AssessmentInstance, "after_update", bump_from_assessment, propagate=True)
    event.listen(AssessmentInstance, "after_delete", bump_from_assessment, propagate=True)

    def bump_from_onboarding_msg(mapper, connection, target):
        _bump_initiative_ts(connection, target.initiative_id)

    event.listen(ChatMessage, "after_insert", bump_from_onboarding_msg, propagate=True)
    event.listen(ChatMessage, "after_update", bump_from_onboarding_msg, propagate=True)

    def bump_from_evidence(mapper, connection, target):
        _bump_initiative_ts(connection, target.initiative_id)

    event.listen(EvidenceDoc, "after_insert", bump_from_evidence, propagate=True)
    event.listen(EvidenceDoc, "after_update", bump_from_evidence, propagate=True)

    def bump_from_evidence_chunk(mapper, connection, target):
        row = connection.execute(
            select(EvidenceDoc.initiative_id).where(EvidenceDoc.id == target.evidence_doc_id)
        ).first()
        if row:
            _bump_initiative_ts(connection, row[0])

    event.listen(EvidenceChunk, "after_insert", bump_from_evidence_chunk, propagate=True)
    event.listen(EvidenceChunk, "after_update", bump_from_evidence_chunk, propagate=True)

    def bump_from_material(mapper, connection, target):
        _bump_initiative_ts(connection, target.initiative_id)

    event.listen(ProjectMaterial, "after_insert", bump_from_material, propagate=True)
    event.listen(ProjectMaterial, "after_update", bump_from_material, propagate=True)

    def bump_from_memo(mapper, connection, target):
        _bump_initiative_ts(connection, target.initiative_id)

    event.listen(MemoVersion, "after_insert", bump_from_memo, propagate=True)
    event.listen(MemoVersion, "after_update", bump_from_memo, propagate=True)

    def bump_from_core_message(mapper, connection, target: CoreChatMessage) -> None:
        row = connection.execute(
            select(
                CoreChat.initiative_id,
                CoreChat.compare_initiative_ids,
            ).where(CoreChat.id == target.chat_id)
        ).first()
        if not row:
            return
        initiative_id, compare_ids = row[0], row[1]
        _bump_initiative_ts(connection, initiative_id)
        if compare_ids and isinstance(compare_ids, list):
            for cid in compare_ids:
                try:
                    _bump_initiative_ts(connection, uuid.UUID(str(cid)))
                except (ValueError, TypeError):
                    pass

    event.listen(CoreChatMessage, "after_insert", bump_from_core_message, propagate=True)
    event.listen(CoreChatMessage, "after_update", bump_from_core_message, propagate=True)


_register_child_listeners()
