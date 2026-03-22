"""Add icons to existing projects based on their titles."""

import asyncio
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.initiative import Initiative
from app.services.chat_agent import ChatAgentService


async def add_icons_to_existing_projects():
    """Add icons to projects that don't have them yet."""
    async with AsyncSessionLocal() as db:
        # Get all projects without icons
        result = await db.execute(
            select(Initiative).where(
                Initiative.icon.is_(None),
                Initiative.title.isnot(None),
                not Initiative.archived
            )
        )
        initiatives = result.scalars().all()
        
        if not initiatives:
            print("No projects need icon updates.")
            return
        
        print(f"Found {len(initiatives)} projects to update with icons...")
        
        chat_agent = ChatAgentService()
        
        for initiative in initiatives:
            try:
                # Use the LLM to pick an appropriate icon based on title and description
                context = initiative.title or ""
                if initiative.project_description:
                    context += f". {initiative.project_description[:200]}"
                
                response = await chat_agent.client.chat.completions.create(
                    model=chat_agent.model,
                    messages=[
                        {
                            "role": "system",
                            "content": "Select a lucide-react icon name that best represents this project. Return ONLY the icon name, nothing else. Examples: 'Sun' for solar, 'Droplet' for water, 'Zap' for energy, 'Sprout' for agriculture, 'Factory' for industrial, 'Heart' for health, 'School' for education, 'Building' for infrastructure, 'Wind' for wind energy, 'Lightbulb' for innovation, 'TreePine' for forestry, 'Fish' for aquaculture, 'Truck' for logistics, 'Store' for retail, 'Home' for housing, 'Users' for community, 'DollarSign' for finance, 'Recycle' for circular economy, 'Flame' for cooking, 'Battery' for storage, 'Plug' for connectivity."
                        },
                        {
                            "role": "user",
                            "content": context
                        }
                    ],
                    temperature=0.3,
                    max_tokens=10,
                )
                
                icon_name = response.choices[0].message.content.strip()
                initiative.icon = icon_name
                
                print(f"✓ Updated '{initiative.title}' with icon: {icon_name}")
                
            except Exception as e:
                print(f"✗ Failed to update '{initiative.title}': {e}")
        
        await db.commit()
        print(f"\n✓ Successfully updated {len(initiatives)} projects!")


if __name__ == "__main__":
    asyncio.run(add_icons_to_existing_projects())
