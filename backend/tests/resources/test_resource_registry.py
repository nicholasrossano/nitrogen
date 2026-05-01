from uuid import uuid4

import pytest

from app.resources import get_resource_registry


def test_resource_registry_contains_required_baseline_resource_types() -> None:
    registry = get_resource_registry()
    resource_types = {definition.resource_type for definition in registry.list_definitions()}
    # Baseline resources required for architecture migration phases.
    assert {
        "initiative",
        "evidence_doc",
        "evidence_chunk",
        "corpus_doc",
        "project_material",
        "memo_version",
        "assessment_instance",
        "artifact",
    }.issubset(resource_types)
    assert len(resource_types) >= 8


@pytest.mark.parametrize(
    "uri,resource_type",
    [
        (f"nitrogen://initiatives/{uuid4()}", "initiative"),
        (f"nitrogen://initiatives/{uuid4()}/evidence/docs/{uuid4()}", "evidence_doc"),
        (f"nitrogen://initiatives/{uuid4()}/evidence/chunks/{uuid4()}", "evidence_chunk"),
        (f"nitrogen://corpus/{uuid4()}", "corpus_doc"),
        (f"nitrogen://initiatives/{uuid4()}/materials/{uuid4()}", "project_material"),
        (f"nitrogen://initiatives/{uuid4()}/memos/{uuid4()}", "memo_version"),
        (f"nitrogen://initiatives/{uuid4()}/assessments/{uuid4()}", "assessment_instance"),
        (f"nitrogen://initiatives/{uuid4()}/artifacts/{uuid4()}", "artifact"),
    ],
)
def test_resource_registry_resolves_phase2_uri_patterns(uri: str, resource_type: str) -> None:
    resolved = get_resource_registry().resolve(uri)
    assert resolved is not None
    definition, params = resolved
    assert definition.resource_type == resource_type
    assert isinstance(params, dict)


def test_resource_registry_returns_none_for_unknown_uri() -> None:
    resolved = get_resource_registry().resolve("nitrogen://unknown/path")
    assert resolved is None
