#!/usr/bin/env python3
"""
Seed a synthetic sample deal for local demos and OSS walkthroughs.

All content is fictional — safe to redistribute under the repo license.
Run after migrations: python3 scripts/seed_demo_deal.py
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings
from app.models.finding import Finding
from app.models.project import Project
from app.models.user import User
from app.services.workspaces import ensure_company_workspace

DEMO_PROJECT_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
DEMO_USER_ID = "demo-seed-user"
DEMO_EMAIL = "demo@nitrogen.local"


async def seed(session: AsyncSession) -> None:
    user = await session.get(User, DEMO_USER_ID)
    if user is None:
        session.add(User(id=DEMO_USER_ID, email=DEMO_EMAIL))
        await session.flush()

    workspace = await ensure_company_workspace(session, DEMO_USER_ID)

    existing = await session.get(Project, DEMO_PROJECT_ID)
    if existing:
        print("Demo project already exists — skipping")
        return

    project = Project(
        id=DEMO_PROJECT_ID,
        workspace_id=workspace.id,
        created_by=DEMO_USER_ID,
        name="Helios Grid Storage Co.",
        subject=(
            "Series B diligence on a 200 MWh LDES developer targeting C&I and utility-scale "
            " deployments in the US Southwest. Focus: offtake quality, interconnection risk, "
            "and impact additionality vs grid peaker displacement."
        ),
        slug="helios-grid-storage",
        sector="energy_storage",
        geography="US Southwest",
        stage="execute",
        evidence_ready=True,
    )
    session.add(project)

    session.add(
        Finding(
            project_id=project.id,
            body=(
                "Initial management deck claims 85% capacity factor on contracted C&I sites; "
                "utility interconnection queue positions average 18 months in target ISOs. "
                "Recommend validating offtake counterparty credit and curtailment clauses."
            ),
            promoted_by=DEMO_USER_ID,
            sources=[],
        )
    )

    await session.commit()
    print(f"Seeded demo project {project.name} ({project.id}) in workspace {workspace.id}")


async def main() -> None:
    settings = get_settings()
    engine = create_async_engine(settings.database_url)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        await seed(session)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
