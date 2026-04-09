from app.adapters import get_adapter_registry
from app.models.module_instance import ModuleInstanceStatus
from app.modules import get_module_registry
from app.modules.base import ModuleManifest
from app.modules.assessment_base import BaseAssessmentModule
from app.services.module_workflow_service import uses_recalculating_build


def test_registered_modules_expose_manifest_contract() -> None:
    modules = get_module_registry().get_all_modules()
    assert modules
    for module in modules:
        manifest = module.manifest
        assert isinstance(manifest, ModuleManifest)
        assert manifest.id == module.definition.id
        assert manifest.name == module.definition.name
        assert isinstance(manifest.adapter_bindings, dict)
        assert isinstance(manifest.input_dependencies, list)
        assert isinstance(manifest.produced_outputs, list)
        assert isinstance(manifest.downstream_dependencies, list)
        assert manifest.assumptions_behavior in {"tracks", "none"}
        assert manifest.evidence_behavior in {"rag_grounded", "user_uploaded", "both", "none"}
        assert manifest.goal
        assert manifest.primary_ui_object
        assert manifest.workspace_build_widget
        assert manifest.workspace_output_widget


def test_manifest_adapter_bindings_resolve_to_registered_adapters() -> None:
    adapter_ids = {
        adapter.definition.adapter_id
        for adapter in get_adapter_registry().list_all()
    }
    for module in get_module_registry().get_all_modules():
        for adapter_id in module.manifest.adapter_bindings.values():
            assert adapter_id in adapter_ids


def test_module_instance_status_enum_values() -> None:
    """ModuleInstanceStatus must cover the full launch lifecycle."""
    required = {"STARTED", "GENERATING", "READY", "COMPLETED"}
    actual = {member.name for member in ModuleInstanceStatus}
    assert required.issubset(actual), f"Missing status values: {required - actual}"


def test_every_module_is_either_widget_or_assessment() -> None:
    """Every registered module must be either widget-backed or assessment-layered."""
    for module in get_module_registry().get_all_modules():
        is_widget = uses_recalculating_build(module)
        is_assessment = isinstance(module, BaseAssessmentModule)
        assert is_widget or is_assessment, (
            f"Module '{module.definition.id}' is neither widget-backed nor assessment-layered"
        )
