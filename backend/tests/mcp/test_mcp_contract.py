from __future__ import annotations

from jsonschema import Draft202012Validator

from app.mcp.exposure_policy import EXPOSED_ADAPTER_IDS, EXPOSED_RESOURCE_TYPES
from app.mcp.server import (
    list_exposed_prompts,
    list_exposed_resource_templates,
    list_exposed_resources,
    list_exposed_tools,
)
from app.resources import get_resource_registry


def test_mcp_tool_discovery_matches_exposure_policy_baseline() -> None:
    tool_names = {tool.name for tool in list_exposed_tools()}
    assert EXPOSED_ADAPTER_IDS.issubset(tool_names)
    assert "memo_generation" not in tool_names


def test_exposed_mcp_tool_schemas_are_valid_json_schema() -> None:
    for tool in list_exposed_tools():
        Draft202012Validator.check_schema(tool.inputSchema)
        assert tool.inputSchema.get("$schema")
        assert tool.inputSchema["type"] == "object"
        assert tool.inputSchema["description"]
        for property_schema in tool.inputSchema.get("properties", {}).values():
            assert property_schema.get("description")

        assert tool.outputSchema is not None
        Draft202012Validator.check_schema(tool.outputSchema)
        assert tool.outputSchema.get("$schema")
        assert tool.outputSchema["type"] == "object"
        assert tool.outputSchema["description"]


def test_mcp_resource_discovery_only_returns_exposed_resource_types() -> None:
    resource_definitions = {
        definition.resource_type: definition
        for definition in get_resource_registry().list_definitions()
    }
    template_uris = {template.uriTemplate for template in list_exposed_resource_templates()}
    resource_uris = {str(resource.uri) for resource in list_exposed_resources()}

    assert len(template_uris) >= len(EXPOSED_RESOURCE_TYPES)
    for resource_type in EXPOSED_RESOURCE_TYPES:
        definition = resource_definitions[resource_type]
        assert definition.visibility == "exposed"
        assert definition.uri_pattern in template_uris
        assert str(definition.uri_pattern).replace("{", "%7B").replace("}", "%7D") in resource_uris

    assert all("/assessments/" not in uri for uri in template_uris | resource_uris)
    assert all("/artifacts/" not in uri for uri in template_uris | resource_uris)


def test_mcp_prompt_discovery_only_returns_exposed_prompts() -> None:
    prompts = list_exposed_prompts()
    assert prompts == []

