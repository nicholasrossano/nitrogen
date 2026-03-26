import logging
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()
_logger = logging.getLogger(__name__)

_db_url = settings.database_url
_is_remote = "localhost" not in _db_url and "127.0.0.1" not in _db_url
if _is_remote and "ssl" not in _db_url and "sslmode" not in _db_url:
    _logger.warning(
        "DATABASE_URL points to a remote host but does not include ssl/sslmode. "
        "Database traffic may be unencrypted. Add ?ssl=require or &sslmode=require."
    )

engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
