"""
Tests for Pydantic schemas.
"""
import uuid
from datetime import datetime

import pytest
from pydantic import ValidationError

from app.schemas.initiative import (
    InitiativeCreate,
    InitiativeUpdate,
    InitiativeSummary,
    InitiativeResponse,
    InitiativeConfirmResponse,
)
from app.schemas.chat import (
    ChatMessageCreate,
    ChatMessageResponse,
    ChatResponse,
    StageStatus,
)


class TestInitiativeSchemas:
    """Tests for Initiative schemas."""

    def test_initiative_create_minimal(self):
        """Test creating InitiativeCreate with minimal data."""
        data = InitiativeCreate()
        assert data.title is None

    def test_initiative_create_with_title(self):
        """Test creating InitiativeCreate with title."""
        data = InitiativeCreate(title="My Initiative")
        assert data.title == "My Initiative"

    def test_initiative_update_partial(self):
        """Test InitiativeUpdate with partial fields."""
        data = InitiativeUpdate(
            title="Updated Title",
            sector="healthcare",
        )
        assert data.title == "Updated Title"
        assert data.sector == "healthcare"
        assert data.geography is None

    def test_initiative_update_constraints(self):
        """Test InitiativeUpdate with constraints list."""
        data = InitiativeUpdate(
            constraints=["Constraint 1", "Constraint 2"]
        )
        assert data.constraints == ["Constraint 1", "Constraint 2"]

    def test_initiative_summary(self):
        """Test InitiativeSummary with defaults."""
        data = InitiativeSummary()
        assert data.constraints == []

    def test_initiative_summary_with_data(self):
        """Test InitiativeSummary with full data."""
        data = InitiativeSummary(
            title="Test",
            sector="education",
            geography="US",
            target_population="Students",
            goal="Improve learning",
            budget_range="$50k-100k",
            timeline="6 months",
            constraints=["Budget", "Time"],
        )
        assert data.title == "Test"
        assert len(data.constraints) == 2

    def test_initiative_response_from_orm(self):
        """Test InitiativeResponse with from_attributes."""
        # Simulate ORM data
        data = InitiativeResponse(
            id=uuid.uuid4(),
            user_id="user-001",
            title="Test Initiative",
            sector="education",
            geography="Global",
            target_population="Students",
            goal="Improve education",
            stage="describe",
            stage_1_complete=False,
            evidence_ready=False,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        assert data.title == "Test Initiative"
        assert data.stage == "describe"

    def test_initiative_confirm_response(self):
        """Test InitiativeConfirmResponse."""
        data = InitiativeConfirmResponse(
            success=True,
            stage="evidence",
            message="Initiative confirmed",
        )
        assert data.success is True
        assert data.stage == "evidence"


class TestChatSchemas:
    """Tests for Chat schemas."""

    def test_chat_message_create(self):
        """Test ChatMessageCreate schema."""
        data = ChatMessageCreate(content="Hello, world!")
        assert data.content == "Hello, world!"

    def test_chat_message_create_empty_fails(self):
        """Test that empty content fails validation."""
        with pytest.raises(ValidationError):
            ChatMessageCreate(content="")

    def test_chat_message_response(self):
        """Test ChatMessageResponse schema."""
        data = ChatMessageResponse(
            id=uuid.uuid4(),
            role="assistant",
            content="Hello!",
            created_at=datetime.utcnow(),
        )
        assert data.role == "assistant"
        assert data.widget_type is None
        assert data.widget_data is None

    def test_chat_message_response_with_widget(self):
        """Test ChatMessageResponse with widget data."""
        widget_data = {"options": ["A", "B", "C"]}
        data = ChatMessageResponse(
            id=uuid.uuid4(),
            role="assistant",
            content="Please choose:",
            widget_type="confirmation",
            widget_data=widget_data,
            created_at=datetime.utcnow(),
        )
        assert data.widget_type == "confirmation"
        assert data.widget_data == widget_data

    def test_stage_status(self):
        """Test StageStatus schema."""
        data = StageStatus(
            stage="describe",
            stage_1_complete=False,
            evidence_ready=False,
            required_fields_complete=False,
            missing_fields=["title", "geography"],
        )
        assert data.stage == "describe"
        assert len(data.missing_fields) == 2

    def test_chat_response(self):
        """Test ChatResponse schema."""
        message = ChatMessageResponse(
            id=uuid.uuid4(),
            role="assistant",
            content="Test",
            created_at=datetime.utcnow(),
        )
        status = StageStatus(
            stage="describe",
            stage_1_complete=False,
            evidence_ready=False,
            required_fields_complete=True,
            missing_fields=[],
        )
        data = ChatResponse(
            message=message,
            stage_status=status,
            show_confirmation=False,
        )
        assert data.message.content == "Test"
        assert data.show_confirmation is False


class TestSchemaValidation:
    """Tests for schema validation edge cases."""

    def test_uuid_validation(self):
        """Test that UUIDs are properly validated."""
        valid_uuid = uuid.uuid4()
        data = ChatMessageResponse(
            id=valid_uuid,
            role="user",
            content="Test",
            created_at=datetime.utcnow(),
        )
        assert data.id == valid_uuid

    def test_datetime_handling(self):
        """Test datetime serialization."""
        now = datetime.utcnow()
        data = ChatMessageResponse(
            id=uuid.uuid4(),
            role="user",
            content="Test",
            created_at=now,
        )
        assert data.created_at == now

    def test_optional_fields(self):
        """Test optional fields handling."""
        data = InitiativeResponse(
            id=uuid.uuid4(),
            user_id="user-001",
            sector="education",
            stage="describe",
            stage_1_complete=False,
            evidence_ready=False,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        assert data.title is None
        assert data.geography is None
        assert data.budget_range is None
        assert data.selected_tools is None

    def test_list_fields(self):
        """Test list field handling."""
        data = InitiativeResponse(
            id=uuid.uuid4(),
            user_id="user-001",
            sector="education",
            stage="describe",
            stage_1_complete=False,
            evidence_ready=False,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            constraints=["A", "B"],
            selected_tools=["tool1", "tool2"],
        )
        assert data.constraints == ["A", "B"]
        assert data.selected_tools == ["tool1", "tool2"]

    def test_dict_fields(self):
        """Test dict field handling."""
        tool_inputs = {"field1": "value1", "field2": 123}
        data = InitiativeResponse(
            id=uuid.uuid4(),
            user_id="user-001",
            sector="education",
            stage="describe",
            stage_1_complete=False,
            evidence_ready=False,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            tool_inputs=tool_inputs,
        )
        assert data.tool_inputs == tool_inputs
