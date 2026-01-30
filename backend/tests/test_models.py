"""
Tests for database models.
"""
import uuid
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.initiative import Initiative, InitiativeStage
from app.models.chat import ChatMessage, MessageRole
from app.core.auth import MockUser


class TestInitiativeModel:
    """Tests for Initiative model."""

    @pytest.mark.asyncio
    async def test_create_initiative(self, db_session: AsyncSession, mock_user: MockUser):
        """Test creating a basic initiative."""
        initiative = Initiative(
            user_id=mock_user.uid,
            title="Test Initiative",
            sector="education",
        )
        db_session.add(initiative)
        await db_session.commit()
        
        assert initiative.id is not None
        assert initiative.user_id == mock_user.uid
        assert initiative.title == "Test Initiative"
        assert initiative.sector == "education"
        assert initiative.stage == InitiativeStage.DESCRIBE.value

    @pytest.mark.asyncio
    async def test_initiative_default_values(self, db_session: AsyncSession, mock_user: MockUser):
        """Test initiative default values."""
        initiative = Initiative(user_id=mock_user.uid)
        db_session.add(initiative)
        await db_session.commit()
        
        assert initiative.sector == "general"
        assert initiative.stage == InitiativeStage.DESCRIBE.value
        assert initiative.stage_1_complete is False
        assert initiative.evidence_ready is False
        assert initiative.created_at is not None

    @pytest.mark.asyncio
    async def test_has_project_description(self, db_session: AsyncSession, mock_user: MockUser):
        """Test has_project_description method."""
        # Without description
        initiative = Initiative(user_id=mock_user.uid)
        assert initiative.has_project_description() is False
        
        # With short description
        initiative.project_description = "Short"
        assert initiative.has_project_description() is False
        
        # With proper description
        initiative.project_description = "This is a proper project description that is long enough."
        assert initiative.has_project_description() is True

    @pytest.mark.asyncio
    async def test_has_selected_tools(self, db_session: AsyncSession, mock_user: MockUser):
        """Test has_selected_tools method."""
        initiative = Initiative(user_id=mock_user.uid)
        assert initiative.has_selected_tools() is False
        
        initiative.selected_tools = []
        assert initiative.has_selected_tools() is False
        
        initiative.selected_tools = ["investment_memo"]
        assert initiative.has_selected_tools() is True

    @pytest.mark.asyncio
    async def test_is_intake_complete(self, db_session: AsyncSession, mock_user: MockUser):
        """Test is_intake_complete method (legacy)."""
        initiative = Initiative(user_id=mock_user.uid)
        assert initiative.is_intake_complete() is False
        
        initiative.title = "Test"
        initiative.sector = "education"
        initiative.geography = "Global"
        initiative.target_population = "Students"
        initiative.goal = "Improve education"
        
        assert initiative.is_intake_complete() is True

    @pytest.mark.asyncio
    async def test_to_summary_dict(self, complete_initiative: Initiative):
        """Test to_summary_dict method."""
        summary = complete_initiative.to_summary_dict()
        
        assert summary["title"] == "Complete Initiative"
        assert summary["sector"] == "healthcare"
        assert summary["geography"] == "Global"
        assert summary["target_population"] == "Healthcare workers"
        assert summary["goal"] == "Improve healthcare access"
        assert summary["budget_range"] == "$100k-500k"
        assert summary["timeline"] == "12 months"
        assert isinstance(summary["constraints"], list)
        assert "project_description" in summary
        assert "selected_tools" in summary


class TestChatMessageModel:
    """Tests for ChatMessage model."""

    @pytest.mark.asyncio
    async def test_create_chat_message(
        self, 
        db_session: AsyncSession, 
        sample_initiative: Initiative
    ):
        """Test creating a chat message."""
        message = ChatMessage(
            initiative_id=sample_initiative.id,
            role="user",
            content="Hello, this is a test message",
        )
        db_session.add(message)
        await db_session.commit()
        
        assert message.id is not None
        assert message.initiative_id == sample_initiative.id
        assert message.role == "user"
        assert message.content == "Hello, this is a test message"

    @pytest.mark.asyncio
    async def test_chat_message_with_widget(
        self, 
        db_session: AsyncSession, 
        sample_initiative: Initiative
    ):
        """Test creating a chat message with widget data."""
        widget_data = {"status": "ready", "options": ["option1", "option2"]}
        message = ChatMessage(
            initiative_id=sample_initiative.id,
            role="assistant",
            content="Please select an option",
            widget_type="confirmation",
            widget_data=widget_data,
        )
        db_session.add(message)
        await db_session.commit()
        
        assert message.widget_type == "confirmation"
        assert message.widget_data == widget_data

    @pytest.mark.asyncio
    async def test_chat_message_roles(
        self, 
        db_session: AsyncSession, 
        sample_initiative: Initiative
    ):
        """Test different message roles."""
        roles = ["user", "assistant", "system"]
        
        for role in roles:
            message = ChatMessage(
                initiative_id=sample_initiative.id,
                role=role,
                content=f"Message with {role} role",
            )
            db_session.add(message)
            await db_session.commit()
            
            assert message.role == role

    @pytest.mark.asyncio
    async def test_chat_message_ordering(
        self, 
        db_session: AsyncSession, 
        sample_initiative: Initiative
    ):
        """Test that messages can be ordered by created_at."""
        messages = []
        for i in range(3):
            message = ChatMessage(
                initiative_id=sample_initiative.id,
                role="user",
                content=f"Message {i}",
            )
            db_session.add(message)
            await db_session.commit()
            messages.append(message)
        
        # Query with ordering
        result = await db_session.execute(
            select(ChatMessage)
            .where(ChatMessage.initiative_id == sample_initiative.id)
            .order_by(ChatMessage.created_at)
        )
        ordered_messages = result.scalars().all()
        
        assert len(ordered_messages) == 3
        for i, msg in enumerate(ordered_messages):
            assert msg.content == f"Message {i}"


class TestInitiativeStageEnum:
    """Tests for InitiativeStage enum."""

    def test_stage_values(self):
        """Test that all expected stages exist."""
        expected_stages = [
            "describe", "select_tools", "gather_inputs", 
            "review", "generate", "complete"
        ]
        
        for stage in expected_stages:
            assert hasattr(InitiativeStage, stage.upper())

    def test_stage_string_values(self):
        """Test that stages have correct string values."""
        assert InitiativeStage.DESCRIBE.value == "describe"
        assert InitiativeStage.SELECT_TOOLS.value == "select_tools"
        assert InitiativeStage.GATHER_INPUTS.value == "gather_inputs"
        assert InitiativeStage.REVIEW.value == "review"
        assert InitiativeStage.GENERATE.value == "generate"
        assert InitiativeStage.COMPLETE.value == "complete"
