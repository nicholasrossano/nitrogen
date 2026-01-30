"""
Tests for database models.

Note: These tests focus on model logic (pure Python) rather than database operations
because the models use PostgreSQL-specific types (ARRAY, JSONB, Vector) that are
not compatible with SQLite used in testing.

For integration tests that test actual database operations, use a PostgreSQL test database.
"""
import uuid
import pytest

from app.models.initiative import Initiative, InitiativeStage
from app.models.chat import ChatMessage, MessageRole
from app.core.auth import MockUser


class TestInitiativeModel:
    """Tests for Initiative model business logic."""

    def test_initiative_instantiation(self):
        """Test creating an initiative instance."""
        initiative = Initiative(
            id=uuid.uuid4(),
            user_id="test-user-001",
            title="Test Initiative",
            sector="education",
        )
        
        assert initiative.user_id == "test-user-001"
        assert initiative.title == "Test Initiative"
        assert initiative.sector == "education"

    def test_initiative_with_sector(self):
        """Test initiative sector value."""
        # When explicitly set
        initiative = Initiative(user_id="test-user-001", sector="education")
        assert initiative.sector == "education"
        
        # Note: Default values are applied by SQLAlchemy at DB commit time,
        # not at instance creation time.

    def test_initiative_with_stage(self):
        """Test initiative stage value."""
        # When explicitly set
        initiative = Initiative(
            user_id="test-user-001", 
            stage=InitiativeStage.SELECT_TOOLS.value
        )
        assert initiative.stage == InitiativeStage.SELECT_TOOLS.value

    def test_has_project_description_none(self):
        """Test has_project_description with no description."""
        initiative = Initiative(user_id="test-user-001")
        assert initiative.has_project_description() is False

    def test_has_project_description_short(self):
        """Test has_project_description with short description."""
        initiative = Initiative(user_id="test-user-001")
        initiative.project_description = "Short"
        assert initiative.has_project_description() is False

    def test_has_project_description_valid(self):
        """Test has_project_description with valid description."""
        initiative = Initiative(user_id="test-user-001")
        initiative.project_description = "This is a proper project description that is long enough."
        assert initiative.has_project_description() is True

    def test_has_selected_tools_none(self):
        """Test has_selected_tools with no tools."""
        initiative = Initiative(user_id="test-user-001")
        assert initiative.has_selected_tools() is False

    def test_has_selected_tools_empty(self):
        """Test has_selected_tools with empty list."""
        initiative = Initiative(user_id="test-user-001")
        initiative.selected_tools = []
        assert initiative.has_selected_tools() is False

    def test_has_selected_tools_with_tools(self):
        """Test has_selected_tools with tools selected."""
        initiative = Initiative(user_id="test-user-001")
        initiative.selected_tools = ["investment_memo"]
        assert initiative.has_selected_tools() is True

    def test_is_intake_complete_incomplete(self):
        """Test is_intake_complete with missing fields."""
        initiative = Initiative(user_id="test-user-001")
        assert initiative.is_intake_complete() is False

    def test_is_intake_complete_partial(self):
        """Test is_intake_complete with partial fields."""
        initiative = Initiative(user_id="test-user-001")
        initiative.title = "Test"
        initiative.sector = "education"
        assert initiative.is_intake_complete() is False

    def test_is_intake_complete_full(self):
        """Test is_intake_complete with all required fields."""
        initiative = Initiative(user_id="test-user-001")
        initiative.title = "Test"
        initiative.sector = "education"
        initiative.geography = "Global"
        initiative.target_population = "Students"
        initiative.goal = "Improve education"
        assert initiative.is_intake_complete() is True

    def test_to_summary_dict(self):
        """Test to_summary_dict method."""
        initiative = Initiative(
            id=uuid.uuid4(),
            user_id="test-user-001",
            title="Complete Initiative",
            sector="healthcare",
            geography="Global",
            target_population="Healthcare workers",
            goal="Improve healthcare access",
            budget_range="$100k-500k",
            timeline="12 months",
            constraints=["Limited resources", "Time constraints"],
            project_description="A comprehensive healthcare initiative.",
            project_type="healthcare",
            selected_tools=["investment_memo"],
            stage=InitiativeStage.SELECT_TOOLS.value,
        )
        
        summary = initiative.to_summary_dict()
        
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

    def test_to_summary_dict_with_none_values(self):
        """Test to_summary_dict with None values."""
        initiative = Initiative(user_id="test-user-001")
        summary = initiative.to_summary_dict()
        
        assert summary["title"] is None
        assert summary["constraints"] == []
        assert summary["selected_tools"] == []
        assert summary["tool_inputs"] == {}


class TestChatMessageModel:
    """Tests for ChatMessage model."""

    def test_chat_message_instantiation(self):
        """Test creating a chat message instance."""
        initiative_id = uuid.uuid4()
        message = ChatMessage(
            id=uuid.uuid4(),
            initiative_id=initiative_id,
            role="user",
            content="Hello, this is a test message",
        )
        
        assert message.initiative_id == initiative_id
        assert message.role == "user"
        assert message.content == "Hello, this is a test message"

    def test_chat_message_with_widget(self):
        """Test chat message with widget data."""
        widget_data = {"status": "ready", "options": ["option1", "option2"]}
        message = ChatMessage(
            id=uuid.uuid4(),
            initiative_id=uuid.uuid4(),
            role="assistant",
            content="Please select an option",
            widget_type="confirmation",
            widget_data=widget_data,
        )
        
        assert message.widget_type == "confirmation"
        assert message.widget_data == widget_data

    def test_chat_message_roles(self):
        """Test different message roles."""
        for role in ["user", "assistant", "system"]:
            message = ChatMessage(
                id=uuid.uuid4(),
                initiative_id=uuid.uuid4(),
                role=role,
                content=f"Message with {role} role",
            )
            assert message.role == role

    def test_chat_message_default_widget(self):
        """Test chat message default widget values."""
        message = ChatMessage(
            id=uuid.uuid4(),
            initiative_id=uuid.uuid4(),
            role="user",
            content="Test message",
        )
        
        assert message.widget_type is None
        assert message.widget_data is None


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
