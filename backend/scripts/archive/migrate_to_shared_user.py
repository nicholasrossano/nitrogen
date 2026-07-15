"""
Migration script to move all existing initiatives to the shared-user ID.

This is needed when switching from Firebase multi-user auth to shared access code mode.

Usage:
    python -m backend.scripts.migrate_to_shared_user
    
Or with explicit database URL:
    DATABASE_URL="postgresql+asyncpg://..." python -m backend.scripts.migrate_to_shared_user
"""

import asyncio
import sys
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

# Add parent directory to path to import app assessments
sys.path.insert(0, '.')

from app.models.project import Project
from app.config import get_settings

SHARED_USER_ID = "shared-user"

async def migrate_initiatives():
    """Update all initiatives to use the shared user ID."""
    settings = get_settings()
    
    if not settings.database_url:
        print("❌ DATABASE_URL not set in environment")
        return
    
    print("🔗 Connecting to database...")
    engine = create_async_engine(
        settings.database_url,
        echo=False,
        pool_pre_ping=True,
    )
    
    async_session = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    
    async with async_session() as session:
        # Count total initiatives
        result = await session.execute(
            select(Project).where(Project.user_id != SHARED_USER_ID)
        )
        initiatives = result.scalars().all()
        
        if not initiatives:
            print(f"✅ No initiatives to migrate - all already using '{SHARED_USER_ID}'")
            return
        
        print(f"\n📊 Found {len(initiatives)} initiative(s) to migrate:")
        for initiative in initiatives:
            title = initiative.title or "(Untitled)"
            print(f"  - {title} (user_id: {initiative.user_id})")
        
        print(f"\n🔄 Migrating all initiatives to user_id='{SHARED_USER_ID}'...")
        
        # Update all initiatives
        await session.execute(
            update(Project)
            .where(Project.user_id != SHARED_USER_ID)
            .values(user_id=SHARED_USER_ID)
        )
        
        await session.commit()
        
        # Verify
        result = await session.execute(
            select(Project).where(Project.user_id == SHARED_USER_ID)
        )
        migrated = result.scalars().all()
        
        print("\n✅ Migration complete!")
        print(f"   {len(migrated)} initiative(s) now using shared user ID")
        print("\n🎉 All projects will now be visible in shared access code mode")
    
    await engine.dispose()

if __name__ == "__main__":
    print("=" * 60)
    print("  Migrate Initiatives to Shared User")
    print("=" * 60)
    asyncio.run(migrate_initiatives())
