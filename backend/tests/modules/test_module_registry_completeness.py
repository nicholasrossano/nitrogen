from app.modules import get_module_registry


def test_module_registry_loads_with_manifest_completeness_checks() -> None:
    registry = get_module_registry()
    modules = registry.get_all_modules()
    assert modules

    module_ids = {module.definition.id for module in modules}
    for module in modules:
        manifest = module.manifest
        for dependency in manifest.input_dependencies:
            assert dependency in module_ids
        if manifest.export_artifact_types:
            assert module.definition.export_format is not None
