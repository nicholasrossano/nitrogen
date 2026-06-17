import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import type { EditorWidget } from '@/components/editor/EditorSidePanel';
import type { ProjectMaterial } from '@/lib/api';

export function editorWidgetForCitation(citation: ResearchPanelCitation): EditorWidget {
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

export function editorWidgetForProjectMaterial(file: ProjectMaterial): EditorWidget {
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
