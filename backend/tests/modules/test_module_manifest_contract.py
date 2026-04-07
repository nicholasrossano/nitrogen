from app.adapters import get_adapter_registry
from app.modules import get_module_registry
from app.modules.base import ModuleManifest


def test_registered_modules_expose_manifest_contract() -> None:
    modules = get_module_registry().get_all_modules()
    assert modules
    for module in modules:
        manifest = module.manifest
        assert isinstance(manifest, ModuleManifest)
        assert manifest.id == module.definition.id
        assert manifest.name == module.definition.name
        assert manifest.module_class in {"foundational", "template_based"}
        assert isinstance(manifest.adapter_bindings, dict)
        assert isinstance(manifest.input_dependencies, list)
        assert isinstance(manifest.produced_outputs, list)
        assert isinstance(manifest.downstream_dependencies, list)
        assert manifest.assumptions_behavior in {"tracks", "none"}
        assert manifest.evidence_behavior in {"rag_grounded", "user_uploaded", "both", "none"}


def test_manifest_adapter_bindings_resolve_to_registered_adapters() -> None:
    adapter_ids = {
        adapter.definition.adapter_id
        for adapter in get_adapter_registry().list_all()
    }
    for module in get_module_registry().get_all_modules():
        for adapter_id in module.manifest.adapter_bindings.values():
            assert adapter_id in adapter_ids
