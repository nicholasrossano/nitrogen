import pytest

from app.adapters import get_adapter_registry
from app.adapters.base import AdapterResult
from app.core.execution_context import ExecutionContext


def _ctx() -> ExecutionContext:
    return ExecutionContext(
        user_id="test-user",
        user_email="test@example.com",
        project_id=None,
        initiative_role=None,
        ai_access_granted=True,
        is_byok=False,
        request_id="test-request-id",
    )


def test_adapter_registry_contains_required_baseline_adapters() -> None:
    registry = get_adapter_registry()
    ids = {adapter.definition.adapter_id for adapter in registry.list_all()}
    # Baseline adapters required for architecture migration phases.
    assert {
        "lcoe",
        "carbon",
        "pvwatts",
        "retrieval",
        "openalex",
        "rag",
        "memo_generation",
    }.issubset(ids)
    assert len(ids) >= 7


def test_adapter_definitions_have_required_metadata() -> None:
    registry = get_adapter_registry()
    for adapter in registry.list_all():
        definition = adapter.definition
        assert definition.adapter_id
        assert definition.name
        assert definition.description
        assert isinstance(definition.input_schema, dict)
        assert isinstance(definition.output_schema, dict)
        assert definition.visibility in {"internal", "assessment_bound", "exposed"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "adapter_id,inputs",
    [
        ("lcoe", {"known_values": {}}),
        ("carbon", {"known_values": {}}),
    ],
)
async def test_compute_adapters_return_adapter_result_shape(adapter_id: str, inputs: dict) -> None:
    adapter = get_adapter_registry().get(adapter_id)
    assert adapter is not None

    result = await adapter.execute(_ctx(), None, inputs)
    assert isinstance(result, AdapterResult)
    assert isinstance(result.output, dict)
    assert isinstance(result.execution_meta, dict)
    assert isinstance(result.provenance, list)
    assert isinstance(result.warnings, list)
