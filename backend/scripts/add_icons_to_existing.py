"""Add icons to existing projects based on their titles."""

import asyncio
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.llm_client import get_openai_client
from app.models.project import Project

ICON_MODEL = "gpt-4o-mini"


async def add_icons_to_existing_projects():
    """Add icons to projects that don't have them yet."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Project).where(
                Project.icon.is_(None),
                Project.name.isnot(None),
                Project.archived.is_(False),
            )
        )
        projects = result.scalars().all()

        if not projects:
            print("No projects need icon updates.")
            return

        print(f"Found {len(projects)} projects to update with icons...")

        client, _is_byok = await get_openai_client(None, db)

        for project in projects:
            try:
                context = project.name or ""
                if project.subject:
                    context += f". {project.subject[:200]}"

                response = await client.chat.completions.create(
                    model=ICON_MODEL,
                    messages=[
                        {
                            "role": "system",
                            "content": "Select a lucide-react icon name that best represents this project. Return ONLY the icon name, nothing else. Examples: 'Sun' for solar, 'Droplet' for water, 'Zap' for energy, 'Sprout' for agriculture, 'Factory' for industrial, 'Heart' for health, 'School' for education, 'Building' for infrastructure, 'Wind' for wind energy, 'Lightbulb' for innovation, 'TreePine' for forestry, 'Fish' for aquaculture, 'Truck' for logistics, 'Store' for retail, 'Home' for housing, 'Users' for community, 'DollarSign' for finance, 'Recycle' for circular economy, 'Flame' for cooking, 'Battery' for storage, 'Plug' for connectivity.",
                        },
                        {"role": "user", "content": context},
                    ],
                    temperature=0.3,
                    max_tokens=10,
                )

                icon_name = response.choices[0].message.content.strip()
                project.icon = icon_name

                print(f"✓ Updated '{project.name}' with icon: {icon_name}")

            except Exception as e:
                print(f"✗ Failed to update '{project.name}': {e}")

        await db.commit()
        print(f"\n✓ Successfully updated {len(projects)} projects!")


if __name__ == "__main__":
    asyncio.run(add_icons_to_existing_projects())
