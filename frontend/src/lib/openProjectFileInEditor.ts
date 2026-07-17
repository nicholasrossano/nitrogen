import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import type { FloatWidget } from '@/components/editor/FloatLayer';
import type { Variable, ProjectMaterial } from '@/lib/api';

export function floatWidgetForCitation(citation: ResearchPanelCitation): FloatWidget {
  return {
    type: 'document_viewer',
    data: {
      evidence_doc_id: citation.evidence_doc_id,
      chunk_id: citation.chunk_id,
      title: citation.source_title,
    },
    messageId: `document-${citation.evidence_doc_id}`,
  };
}

export function floatWidgetForProjectMaterial(file: ProjectMaterial): FloatWidget {
  if (file.source === 'evidence') {
    return {
      type: 'document_viewer',
      data: {
        evidence_doc_id: file.id,
        title: file.filename,
        filename: file.filename,
        file_type: file.file_type,
      },
      messageId: `document-${file.id}`,
    };
  }

  return {
    type: 'document_viewer',
    data: {
      project_material_id: file.id,
      file_type: file.file_type,
      title: file.filename,
      filename: file.filename,
    },
    messageId: `material-${file.id}`,
  };
}

/** Assessment report saved to project Files — open like any other material, with back to assessment. */
export function floatWidgetForAssessmentReport(payload: {
  material: ProjectMaterial;
  instanceId: string;
  assessmentId: string;
  title: string;
}): FloatWidget {
  const base = floatWidgetForProjectMaterial(payload.material);
  return {
    ...base,
    data: {
      ...base.data,
      title: payload.material.filename,
      assessment_title: payload.title,
      instance_id: payload.instanceId,
      assessment_id: payload.assessmentId,
      // Bust the viewer cache when Report upserts the same material id.
      reload_token: `${payload.material.id}:${payload.material.file_size ?? 0}:${Date.now()}`,
    },
    messageId: `assessment-report-${payload.instanceId}`,
  };
}

export function floatWidgetForVariable(variable: Variable): FloatWidget {
  return {
    type: 'variable_detail',
    data: {
      variable,
      title: variable.label,
    },
    messageId: `variable-${variable.id}`,
  };
}

/** @deprecated Prefer floatWidgetForCitation. */
export const editorWidgetForCitation = floatWidgetForCitation;
/** @deprecated Prefer floatWidgetForProjectMaterial. */
export const editorWidgetForProjectMaterial = floatWidgetForProjectMaterial;
/** @deprecated Prefer floatWidgetForVariable. */
export const editorWidgetForVariable = floatWidgetForVariable;
