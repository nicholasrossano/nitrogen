#!/usr/bin/env python3
"""One-time maintenance: wipe empty assumptions, then re-extract from project sources.

Usage:
  cd backend && python3 scripts/wipe_empty_assumptions_and_reextract.py --dry-run
  cd backend && python3 scripts/wipe_empty_assumptions_and_reextract.py --apply
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models.assumption import Assumption, AssumptionBinding
from app.models.chat import CoreChat
from app.models.project import Project
from app.services.assumptions import AssumptionActor, extract_assumptions_from_sources

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("wipe_reextract")

EMPTY_STATUSES = {"missing"}
EMPTY_SOURCE_TYPES = {"missing_placeholder", "default"}
EMPTY_STRING_TOKENS = {
    "",
    "—",
    "-",
    "n/a",
    "na",
    "none",
    "null",
    "missing",
    "tbd",
    "unknown",
}


def _is_empty_value(value) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip().lower() in EMPTY_STRING_TOKENS or value.strip().lower().startswith("unknown ")
    if isinstance(value, (list, dict)) and len(value) == 0:
        return True
    return False


def is_empty_assumption(row: Assumption) -> bool:
    if row.status in EMPTY_STATUSES:
        return True
    if row.source_type in EMPTY_SOURCE_TYPES:
        return True
    return _is_empty_value(row.value)


async def wipe_empty(db: AsyncSession, *, apply: bool) -> list:
    result = await db.execute(select(Assumption))
    rows = list(result.scalars().all())
    empties = [r for r in rows if is_empty_assumption(r)]
    logger.info("assumptions total=%s empty=%s keep=%s", len(rows), len(empties), len(rows) - len(empties))
    for row in empties[:20]:
        logger.info(
            "  wipe candidate key=%s status=%s source=%s value=%r project=%s",
            row.key,
            row.status,
            row.source_type,
            row.value,
            row.project_id,
        )
    if len(empties) > 20:
        logger.info("  ... and %s more", len(empties) - 20)

    if not apply or not empties:
        return empties

    empty_ids = [r.id for r in empties]

    # Detach assumption-scoped chats (FK is SET NULL, but be explicit).
    chat_result = await db.execute(select(CoreChat).where(CoreChat.assumption_id.in_(empty_ids)))
    chats = list(chat_result.scalars().all())
    for chat in chats:
        chat.assumption_id = None
    logger.info("cleared assumption_id on %s chats", len(chats))

    await db.execute(delete(AssumptionBinding).where(AssumptionBinding.assumption_id.in_(empty_ids)))
    await db.execute(delete(Assumption).where(Assumption.id.in_(empty_ids)))
    await db.flush()
    logger.info("deleted %s empty assumptions", len(empties))
    return empties


async def projects_with_sources(db: AsyncSession) -> list[Project]:
    result = await db.execute(
        select(Project)
        .where(Project.archived.is_(False))
        .options(selectinload(Project.assessment_instances))
        .order_by(Project.updated_at.desc())
    )
    projects = list(result.scalars().unique().all())
    eligible: list[Project] = []
    for project in projects:
        has_material = await db.scalar(
            text(
                "SELECT 1 FROM project_materials "
                "WHERE project_id = :pid AND content_text IS NOT NULL AND length(content_text) > 0 "
                "LIMIT 1"
            ),
            {"pid": project.id},
        )
        has_evidence = await db.scalar(
            text("SELECT 1 FROM evidence_docs WHERE project_id = :pid LIMIT 1"),
            {"pid": project.id},
        )
        if has_material or has_evidence:
            eligible.append(project)
    return eligible


async def reextract(db: AsyncSession, projects: list[Project], *, apply: bool) -> None:
    logger.info("projects eligible for re-extraction: %s", len(projects))
    if not apply:
        for p in projects:
            logger.info("  would extract project=%s name=%r", p.id, p.name)
        return

    actor = AssumptionActor.system()
    for project in projects:
        try:
            created, updated, touched = await extract_assumptions_from_sources(
                db,
                project,
                actor=actor,
            )
            await db.commit()
            logger.info(
                "extracted project=%s name=%r created=%s updated=%s touched=%s",
                project.id,
                project.name,
                created,
                updated,
                len(touched),
            )
        except Exception:
            await db.rollback()
            logger.exception("extraction failed project=%s name=%r", project.id, project.name)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Report only; no writes.")
    parser.add_argument("--apply", action="store_true", help="Perform wipe + re-extraction.")
    args = parser.parse_args()
    if args.dry_run == args.apply:
        parser.error("Specify exactly one of --dry-run or --apply")

    settings = get_settings()
    engine = create_async_engine(settings.database_url)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    apply = args.apply

    async with Session() as db:
        await wipe_empty(db, apply=apply)
        if apply:
            await db.commit()
        projects = await projects_with_sources(db)
        await reextract(db, projects, apply=apply)

    await engine.dispose()
    logger.info("done (%s)", "applied" if apply else "dry-run")


if __name__ == "__main__":
    asyncio.run(main())
