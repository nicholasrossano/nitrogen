import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import type { FloatWidget } from '@/components/editor/FloatLayer';
import type { Variable, ProjectMaterial } from '@/lib/api';
import { PROJECT_VARIABLES } from '@/lib/projectVariablesCopy';

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
    },
    messageId: `material-${file.id}`,
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

export function floatWidgetForVariablesWorkspace(
  projectId: string,
  focusVariableId?: string | null,
): FloatWidget {
  return {
    type: 'variables_workspace',
    data: {
      title: PROJECT_VARIABLES.title,
      focus_variable_id: focusVariableId ?? null,
    },
    messageId: `variables-${projectId}`,
  };
}

/** @deprecated Prefer floatWidgetForCitation. */
export const editorWidgetForCitation = floatWidgetForCitation;
/** @deprecated Prefer floatWidgetForProjectMaterial. */
export const editorWidgetForProjectMaterial = floatWidgetForProjectMaterial;
/** @deprecated Prefer floatWidgetForVariable. */
export const editorWidgetForVariable = floatWidgetForVariable;
