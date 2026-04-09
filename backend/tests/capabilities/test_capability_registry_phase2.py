from app.adapters import get_adapter_registry
from app.capabilities.registry import CapabilityKind, get_capability_registry
from app.resources import get_resource_registry


def test_capability_registry_contains_all_phase2_adapter_entries() -> None:
    capability_registry = get_capability_registry()
    adapter_entries = capability_registry.list_by_kind(CapabilityKind.ADAPTER)
    adapter_capability_ids = {entry.id for entry in adapter_entries}

    expected_adapter_capability_ids = {
        f"adapter:{adapter.definition.adapter_id}"
        for adapter in get_adapter_registry().list_all()
    }
    assert expected_adapter_capability_ids.issubset(adapter_capability_ids)


def test_capability_registry_contains_all_phase2_resource_entries() -> None:
    capability_registry = get_capability_registry()
    resource_entries = capability_registry.list_by_kind(CapabilityKind.RESOURCE)
    resource_capability_ids = {entry.id for entry in resource_entries}

    expected_resource_capability_ids = {
        definition.uri_pattern
        for definition in get_resource_registry().list_definitions()
    }
    assert expected_resource_capability_ids.issubset(resource_capability_ids)


def test_capability_registry_contains_prompt_entries() -> None:
    capability_registry = get_capability_registry()
    prompt_entries = capability_registry.list_by_kind(CapabilityKind.PROMPT)
    assert prompt_entries
    assert all(entry.id.startswith("prompt:") for entry in prompt_entries)
