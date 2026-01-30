"""
Pytest configuration and fixtures for backend tests.
"""
import asyncio
import os
import uuid
from typing import AsyncGenerator
from unittest.mock import MagicMock, patch, AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import StaticPool

# Mock settings before importing app modules
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["OPENAI_API_KEY"] = "test-key"

from app.core.database import Base
from app.core.auth import MockUser
from app.models.initiative import Initiative, InitiativeStage
from app.models.chat import ChatMessage


# Use in-memory SQLite for testing
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for each test case."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="function")
async def async_engine():
    """Create async engine for testing.
    
    Note: We only create tables that don't use PostgreSQL-specific features
    like pgvector or JSONB. Some tables are excluded due to SQLite limitations.
    """
    engine = create_async_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        echo=False,
    )
    
    # Tables to exclude (have Vector or JSONB columns not supported by SQLite)
    excluded_tables = {
        'evidence_chunks',   # Has Vector column
        'corpus_chunks',     # Has Vector column
        'corpus_documents',  # Has JSONB column
    }
    
    # Get tables to create (exclude those with PostgreSQL-specific columns)
    tables_to_create = []
    for table in Base.metadata.sorted_tables:
        if table.name not in excluded_tables:
            tables_to_create.append(table)
    
    async with engine.begin() as conn:
        for table in tables_to_create:
            await conn.run_sync(table.create, checkfirst=True)
    
    yield engine
    
    async with engine.begin() as conn:
        for table in reversed(tables_to_create):
            await conn.run_sync(table.drop, checkfirst=True)
    
    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def db_session(async_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create async database session for testing."""
    async_session = async_sessionmaker(
        async_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    
    async with async_session() as session:
        yield session
        await session.rollback()


@pytest.fixture
def mock_user() -> MockUser:
    """Create a mock user for testing."""
    return MockUser(uid="test-user-001")


@pytest.fixture
def another_user() -> MockUser:
    """Create another mock user for testing user isolation."""
    return MockUser(uid="test-user-002")


@pytest_asyncio.fixture
async def sample_initiative(db_session: AsyncSession, mock_user: MockUser) -> Initiative:
    """Create a sample initiative for testing."""
    initiative = Initiative(
        id=uuid.uuid4(),
        user_id=mock_user.uid,
        title="Test Initiative",
        sector="education",
        geography="Test Region",
        target_population="Test Population",
        goal="Test Goal",
        stage=InitiativeStage.DESCRIBE.value,
    )
    db_session.add(initiative)
    await db_session.commit()
    await db_session.refresh(initiative)
    return initiative


@pytest_asyncio.fixture
async def complete_initiative(db_session: AsyncSession, mock_user: MockUser) -> Initiative:
    """Create a complete initiative with all fields for testing."""
    initiative = Initiative(
        id=uuid.uuid4(),
        user_id=mock_user.uid,
        title="Complete Initiative",
        sector="healthcare",
        geography="Global",
        target_population="Healthcare workers",
        goal="Improve healthcare access",
        budget_range="$100k-500k",
        timeline="12 months",
        constraints=["Limited resources", "Time constraints"],
        project_description="A comprehensive healthcare initiative to improve access.",
        project_type="healthcare",
        selected_tools=["investment_memo", "due_diligence_checklist"],
        stage=InitiativeStage.SELECT_TOOLS.value,
    )
    db_session.add(initiative)
    await db_session.commit()
    await db_session.refresh(initiative)
    return initiative


@pytest_asyncio.fixture
async def sample_chat_message(
    db_session: AsyncSession, 
    sample_initiative: Initiative
) -> ChatMessage:
    """Create a sample chat message for testing."""
    message = ChatMessage(
        id=uuid.uuid4(),
        initiative_id=sample_initiative.id,
        role="user",
        content="This is a test message",
    )
    db_session.add(message)
    await db_session.commit()
    await db_session.refresh(message)
    return message


@pytest_asyncio.fixture
async def initiative_with_messages(
    db_session: AsyncSession, 
    mock_user: MockUser
) -> Initiative:
    """Create an initiative with chat messages for testing."""
    initiative = Initiative(
        id=uuid.uuid4(),
        user_id=mock_user.uid,
        title="Initiative with Messages",
        sector="education",
        stage=InitiativeStage.DESCRIBE.value,
    )
    db_session.add(initiative)
    await db_session.commit()
    
    # Add messages
    messages = [
        ChatMessage(
            initiative_id=initiative.id,
            role="assistant",
            content="What are you working on?",
        ),
        ChatMessage(
            initiative_id=initiative.id,
            role="user",
            content="I'm working on an education project",
        ),
    ]
    for msg in messages:
        db_session.add(msg)
    await db_session.commit()
    
    await db_session.refresh(initiative)
    return initiative


@pytest.fixture
def mock_openai_client():
    """Create a mock OpenAI client for testing."""
    mock_client = MagicMock()
    mock_completion = MagicMock()
    mock_completion.choices = [
        MagicMock(message=MagicMock(content="Test response"))
    ]
    mock_client.chat.completions.create.return_value = mock_completion
    return mock_client


@pytest.fixture
def mock_openai_async():
    """Create async mock for OpenAI client."""
    async def mock_create(*args, **kwargs):
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content="Test response from AI"))
        ]
        return mock_response
    return mock_create


@pytest.fixture
def sample_pdf_content() -> bytes:
    """Create sample PDF-like content for testing."""
    # This is a minimal valid PDF structure
    return b"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 100 700 Td (Test Content) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000206 00000 n
trailer
<< /Size 5 /Root 1 0 R >>
startxref
300
%%EOF"""


@pytest.fixture
def sample_text_content() -> str:
    """Create sample text content for chunking tests."""
    return """
    This is a sample document for testing the document parser service.
    It contains multiple paragraphs that should be properly chunked.
    
    The chunking algorithm should respect sentence boundaries where possible.
    This ensures that context is preserved across chunks.
    
    Additionally, there should be proper overlap between chunks to maintain
    continuity when using retrieval-augmented generation.
    
    The final chunk should contain the remaining content without truncation.
    This is important for maintaining document integrity.
    """
