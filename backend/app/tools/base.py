"""Base classes for Nitrogen tools."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Literal
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass
class ToolInput:
    """Definition of an input field for a tool."""
    name: str
    label: str
    description: str
    input_type: Literal["text", "textarea", "number", "select", "file", "checkbox"]
    required: bool = True
    options: list[str] | None = None  # For select inputs
    default: Any = None
    placeholder: str | None = None
    
    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "description": self.description,
            "input_type": self.input_type,
            "required": self.required,
            "options": self.options,
            "default": self.default,
            "placeholder": self.placeholder,
        }


@dataclass
class ToolOutput:
    """Result from running a tool."""
    tool_id: str
    output_type: str  # "memo", "checklist", "spreadsheet", "chart", etc.
    title: str
    content: dict[str, Any]  # Structured content
    file_path: str | None = None  # If exported to file


@dataclass
class ToolDefinition:
    """Metadata about a tool."""
    id: str
    name: str
    description: str
    icon: str  # Emoji or icon name
    output_type: str
    category: str  # "analysis", "documentation", "technical", etc.
    keywords: list[str] = field(default_factory=list)  # For recommendation matching
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "icon": self.icon,
            "output_type": self.output_type,
            "category": self.category,
        }


class BaseTool(ABC):
    """Abstract base class for all Nitrogen tools."""
    
    @property
    @abstractmethod
    def definition(self) -> ToolDefinition:
        """Return tool metadata."""
        pass
    
    @property
    @abstractmethod
    def required_inputs(self) -> list[ToolInput]:
        """Return list of required input fields."""
        pass
    
    @property
    def optional_inputs(self) -> list[ToolInput]:
        """Return list of optional input fields. Override in subclass."""
        return []
    
    @property
    def all_inputs(self) -> list[ToolInput]:
        """Return all inputs (required + optional)."""
        return self.required_inputs + self.optional_inputs
    
    def get_questions_for_chat(self) -> list[str]:
        """Generate conversational questions to gather inputs."""
        questions = []
        for inp in self.required_inputs:
            questions.append(inp.description)
        return questions
    
    def validate_inputs(self, inputs: dict[str, Any]) -> tuple[bool, list[str]]:
        """Validate that all required inputs are present."""
        missing = []
        for inp in self.required_inputs:
            if inp.name not in inputs or inputs[inp.name] is None:
                missing.append(inp.label)
        return len(missing) == 0, missing
    
    @abstractmethod
    async def execute(
        self, 
        db: AsyncSession,
        initiative_id: UUID,
        inputs: dict[str, Any],
        include_corpus: bool = True,
    ) -> ToolOutput:
        """Execute the tool and return output."""
        pass
    
    async def export(
        self,
        output: ToolOutput,
        format: str = "docx",
    ) -> str:
        """Export output to file. Override in subclass for custom export."""
        raise NotImplementedError(f"Export not implemented for {self.definition.name}")
