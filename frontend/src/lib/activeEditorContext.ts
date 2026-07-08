import type { EditorWidget } from '@/components/editor/EditorSidePanel';
import type { ActiveEditorContext } from '@/lib/api';

function resolveWidgetTitle(widget: EditorWidget): string {
  const data = widget.data ?? {};
  if (typeof data.title === 'string' && data.title.trim()) return data.title.trim();
  if (typeof data.name === 'string' && data.name.trim()) return data.name.trim();
  if (typeof data.filename === 'string' && data.filename.trim()) return data.filename.trim();
  return 'Untitled';
}

/** Map the active editor widget to the payload the chat stream API expects. */
export function activeEditorContextFromWidget(
  widget: EditorWidget | undefined | null,
): ActiveEditorContext | null {
  if (!widget) return null;

  const title = resolveWidgetTitle(widget);

  switch (widget.type) {
    case 'document_viewer':
      if (typeof widget.data?.evidence_doc_id === 'string') {
        return {
          kind: 'document',
          title,
          evidence_doc_id: widget.data.evidence_doc_id,
          chunk_id: typeof widget.data?.chunk_id === 'string' ? widget.data.chunk_id : null,
        };
      }
      return null;
    case 'assessment_workspace':
      if (
        typeof widget.data?.instance_id === 'string'
        && typeof widget.data?.assessment_id === 'string'
      ) {
        return {
          kind: 'assessment',
          title,
          assessment_id: widget.data.assessment_id,
          instance_id: widget.data.instance_id,
        };
      }
      return null;
    default:
      return null;
  }
}
