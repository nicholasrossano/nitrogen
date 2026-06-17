"""Backward-compatible re-exports — canonical model lives in project.py."""

from app.models.project import Initiative, InitiativeStage, Project

__all__ = ["Initiative", "InitiativeStage", "Project"]
