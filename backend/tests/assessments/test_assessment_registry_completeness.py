from app.assessments import get_assessment_registry


def test_assessment_registry_loads_with_manifest_completeness_checks() -> None:
    registry = get_assessment_registry()
    assessments = registry.get_all_assessments()
    assert assessments

    assessment_ids = {assessment.definition.id for assessment in assessments}
    for assessment in assessments:
        manifest = assessment.manifest
        for dependency in manifest.input_dependencies:
            assert dependency in assessment_ids
        if manifest.export_artifact_types:
            assert assessment.definition.export_format is not None
