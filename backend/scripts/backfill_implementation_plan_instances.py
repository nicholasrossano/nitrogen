"""Backfill implementation_plan module instances from legacy initiative.project_plan.

Usage:
  # Dry run (default)
  python3 scripts/backfill_implementation_plan_instances.py

  # Apply writes
  python3 scripts/backfill_implementation_plan_instances.py --apply
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models.initiative import Initiative  # noqa: E402
from app.models.module_instance import ModuleInstance  # noqa: E402
from app.modules.implementation_plan import ImplementationPlanModule  # noqa: E402
from app.modules.utils import infer_category_icon, make_build_item  # noqa: E402


MIGRATION_ACTOR = "migration:backfill_implementation_plan"
IMPLEMENTATION_MODULE_ID = "implementation_plan"


@dataclass
class BackfillStats:
    total_initiatives: int = 0
    archived_skipped: int = 0
    no_plan_skipped: int = 0
    malformed_plan_skipped: int = 0
    existing_instance_skipped: int = 0
    to_create: int = 0
    created: int = 0
    errors: int = 0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_populated_project_plan(project_plan: Any) -> bool:
    if not isinstance(project_plan, dict):
        return False
    pillars = project_plan.get("pillars")
    if isinstance(pillars, list) and len(pillars) > 0:
        return True
    phases = project_plan.get("phases")
    return isinstance(phases, list) and len(phases) > 0


def _phase_items_from_plan(project_plan: dict[str, Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    pillars = project_plan.get("pillars")

    if isinstance(pillars, list) and pillars:
        for pillar in pillars:
            if not isinstance(pillar, dict):
                continue
            name = str(pillar.get("name") or "").strip()
            if not name:
                continue
            content = {
                "label": name,
                "description": str(pillar.get("summary") or "").strip(),
                "pillar_id": str(pillar.get("id") or "").strip(),
                "icon": str(pillar.get("icon") or infer_category_icon(name)),
            }
            items.append(make_build_item(content=content, derivation="inferred"))
        if items:
            return items

    phases = project_plan.get("phases")
    if isinstance(phases, list):
        for phase in phases:
            if not isinstance(phase, dict):
                continue
            name = str(phase.get("name") or "").strip()
            if not name:
                continue
            content = {
                "label": name,
                "description": str(phase.get("description") or "").strip(),
                "phase_id": str(phase.get("id") or "").strip(),
                "icon": infer_category_icon(name),
            }
            items.append(make_build_item(content=content, derivation="inferred"))

    return items


def _activities_from_plan(project_plan: dict[str, Any]) -> list[dict[str, Any]]:
    activities: list[dict[str, Any]] = []
    pillars = project_plan.get("pillars")
    if not isinstance(pillars, list):
        return activities

    for pillar in pillars:
        if not isinstance(pillar, dict):
            continue
        pillar_name = str(pillar.get("name") or "").strip()
        pillar_id = str(pillar.get("id") or "").strip()
        if not pillar_name:
            continue

        for item in pillar.get("items") or []:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            content = {
                "name": title,
                "category": pillar_name,
                "description": str(item.get("rationale") or "").strip(),
                "pillar_id": pillar_id,
                "item_type": str(item.get("item_type") or "deliverable"),
                "classification": str(item.get("classification") or "unknown"),
                "status": str(item.get("status") or "not_started"),
                "phase": item.get("phase"),
                "phase_order": item.get("phase_order"),
                "supports": item.get("supports") or [],
                "depends_on": item.get("depends_on") or [],
            }
            activities.append(make_build_item(content=content, derivation="inferred"))

    return activities


async def _build_plan_widget_data(
    module: ImplementationPlanModule,
    phase_items: list[dict[str, Any]],
    activity_items: list[dict[str, Any]],
) -> dict[str, Any]:
    confirmed_stages = {
        "phases": {"data": {"items": phase_items}},
        "activities": {"data": {"items": activity_items}},
    }
    return await module.compute_stage("plan", confirmed_stages, context={})


def _build_workflow_state(
    phase_items: list[dict[str, Any]],
    activity_items: list[dict[str, Any]],
    plan_widget_data: dict[str, Any],
) -> dict[str, Any]:
    confirmed_at = _now_iso()
    return {
        "module_type": IMPLEMENTATION_MODULE_ID,
        "current_stage_id": "plan",
        "stages": {
            "phases": {
                "status": "confirmed",
                "confirmed_at": confirmed_at,
                "confirmed_by": MIGRATION_ACTOR,
                "confirmed_by_email": None,
                "data": {"items": phase_items},
            },
            "activities": {
                "status": "confirmed",
                "confirmed_at": confirmed_at,
                "confirmed_by": MIGRATION_ACTOR,
                "confirmed_by_email": None,
                "data": {"items": activity_items},
            },
            "plan": {
                "status": "confirmed",
                "confirmed_at": confirmed_at,
                "confirmed_by": MIGRATION_ACTOR,
                "confirmed_by_email": None,
                "data": {"widget_data": plan_widget_data},
            },
        },
        "final_approval": {
            "status": "pending",
            "approved_at": None,
            "approved_by": None,
            "approved_by_email": None,
        },
    }


async def run_backfill(*, apply: bool) -> BackfillStats:
    stats = BackfillStats()
    module = ImplementationPlanModule()

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Initiative))
        initiatives = result.scalars().all()
        stats.total_initiatives = len(initiatives)
        print(f"Scanning {stats.total_initiatives} initiatives...")

        for initiative in initiatives:
            try:
                if initiative.archived:
                    stats.archived_skipped += 1
                    continue

                project_plan = initiative.project_plan
                if not _is_populated_project_plan(project_plan):
                    stats.no_plan_skipped += 1
                    continue

                existing_result = await db.execute(
                    select(ModuleInstance).where(
                        ModuleInstance.initiative_id == initiative.id,
                        ModuleInstance.module_id == IMPLEMENTATION_MODULE_ID,
                        ModuleInstance.archived.is_(False),
                    )
                )
                existing = existing_result.scalars().first()
                if existing is not None:
                    stats.existing_instance_skipped += 1
                    continue

                phase_items = _phase_items_from_plan(project_plan)
                activity_items = _activities_from_plan(project_plan)
                if not phase_items:
                    stats.malformed_plan_skipped += 1
                    continue

                plan_widget_data = await _build_plan_widget_data(module, phase_items, activity_items)
                workflow_state = _build_workflow_state(phase_items, activity_items, plan_widget_data)
                stats.to_create += 1

                title = (initiative.title or "").strip() or "Implementation Plan"
                if apply:
                    inst = ModuleInstance(
                        initiative_id=initiative.id,
                        module_id=IMPLEMENTATION_MODULE_ID,
                        status="ready",
                        title=title,
                        started_by=initiative.user_id,
                        workflow_state=workflow_state,
                        workflow_version=1,
                    )
                    db.add(inst)
                    stats.created += 1

            except Exception as exc:
                stats.errors += 1
                print(f"[ERROR] initiative={initiative.id}: {exc}")

        if apply:
            await db.commit()
            print("Applied changes.")
        else:
            await db.rollback()
            print("Dry run only: no changes committed.")

    return stats


def print_stats(stats: BackfillStats) -> None:
    print("\nBackfill summary")
    print("----------------")
    print(f"Total initiatives scanned:      {stats.total_initiatives}")
    print(f"Archived skipped:               {stats.archived_skipped}")
    print(f"No project_plan skipped:        {stats.no_plan_skipped}")
    print(f"Malformed project_plan skipped: {stats.malformed_plan_skipped}")
    print(f"Existing impl instances skipped:{stats.existing_instance_skipped}")
    print(f"Eligible to create:             {stats.to_create}")
    print(f"Created:                        {stats.created}")
    print(f"Errors:                         {stats.errors}")


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill implementation_plan module instances from initiative.project_plan"
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Persist changes (default is dry run)",
    )
    args = parser.parse_args()

    stats = await run_backfill(apply=args.apply)
    print_stats(stats)


if __name__ == "__main__":
    asyncio.run(main())
