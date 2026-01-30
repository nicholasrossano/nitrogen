'use client';

import { useState, useEffect } from 'react';
import { FileText, Upload } from 'lucide-react';
import { Initiative, EvidenceDoc, MemoContent, api } from '@/lib/api';
import { MemoViewerWidget } from '@/components/widgets/MemoViewerWidget';
import { ChecklistViewerWidget } from '@/components/widgets/ChecklistViewerWidget';

interface EditorPanelProps {
  initiative: Initiative;
  selectedItemId: string | null;
  selectedItemType: 'input' | 'output' | null;
  evidenceDocs: EvidenceDoc[];
  onUploadClick?: () => void;
}

export function EditorPanel({
  initiative,
  selectedItemId,
  selectedItemType,
  evidenceDocs,
  onUploadClick,
}: EditorPanelProps) {
  // No selection - show empty state
  if (!selectedItemId || !selectedItemType) {
    const hasInputs = evidenceDocs.length > 0;
    const hasOutputs = initiative.deliverables && Object.keys(initiative.deliverables).length > 0;

    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 bg-surface-subtle rounded-lg flex items-center justify-center mb-4">
          <FileText className="w-8 h-8 text-text-tertiary" />
        </div>
        {!hasInputs && !hasOutputs ? (
          <>
            <h3 className="text-lg font-semibold text-text-primary mb-2">
              Get started
            </h3>
            <p className="text-sm text-text-secondary max-w-sm mb-6">
              Upload supporting documents or use the chat to describe your project and generate outputs.
            </p>
            {onUploadClick && (
              <button onClick={onUploadClick} className="btn-secondary text-sm">
                <Upload className="w-4 h-4" />
                Upload documents
              </button>
            )}
          </>
        ) : (
          <>
            <h3 className="text-base font-medium text-text-primary mb-1">
              Select an item
            </h3>
            <p className="text-sm text-text-secondary">
              Click on an input or output above to view it here.
            </p>
          </>
        )}
      </div>
    );
  }

  // Show selected input (evidence doc)
  if (selectedItemType === 'input') {
    const doc = evidenceDocs.find(d => d.id === selectedItemId);
    if (!doc) return null;

    return <EvidenceDocumentViewer doc={doc} />;
  }

  // Show selected output (deliverable)
  if (selectedItemType === 'output' && initiative.deliverables) {
    const deliverable = initiative.deliverables[selectedItemId];
    if (!deliverable) return null;

    const widgetType = deliverable.widget_type;
    const widgetData = deliverable.data || deliverable;

    // Render appropriate widget based on type
    if (widgetType === 'memo_viewer' || selectedItemId.includes('memo')) {
      return (
        <div className="flex-1 overflow-auto p-6 pb-6">
          <MemoViewerWidget
            data={widgetData as MemoContent}
            isActive={true}
            initiativeId={initiative.id}
          />
        </div>
      );
    }

    if (widgetType === 'checklist_viewer' || selectedItemId.includes('checklist')) {
      return (
        <div className="flex-1 overflow-auto p-6 pb-6">
          <ChecklistViewerWidget
            data={widgetData}
            isActive={true}
            initiativeId={initiative.id}
          />
        </div>
      );
    }

    // Default: show raw data
    return (
      <div className="flex-1 overflow-auto p-6 pb-6">
        <div className="card p-6">
          <h3 className="font-semibold text-text-primary mb-4">{deliverable.name || selectedItemId}</h3>
          <pre className="text-xs text-text-secondary bg-surface-subtle p-4 rounded overflow-auto">
            {JSON.stringify(widgetData, null, 2)}
          </pre>
        </div>
      </div>
    );
  }

  return null;
}

// Helper component to display evidence document with content preview
function EvidenceDocumentViewer({ doc }: { doc: EvidenceDoc }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFull, setShowFull] = useState(false);

  // Clean filename - remove "...: Untitled Project" pattern
  const cleanFilename = (filename: string | null) => {
    if (!filename) return 'Document';
    return filename.replace(/\.\.\.:\s*Untitled Project$/i, '');
  };

  useEffect(() => {
    const fetchContent = async () => {
      try {
        setLoading(true);
        const data = await api.getEvidenceContent(doc.id);
        setContent(data.content);
      } catch (error) {
        console.error('Failed to fetch evidence content:', error);
        setContent(null);
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [doc.id]);

  // Content preview limit (3000 characters)
  const PREVIEW_LIMIT = 3000;
  const isTruncated = content && content.length > PREVIEW_LIMIT;
  const displayContent = content && !showFull && isTruncated
    ? content.substring(0, PREVIEW_LIMIT) + '...'
    : content;

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6 pb-6">
      <div className="card-elevated flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-4 bg-surface-header border-b border-divider">
          <div className="w-10 h-10 bg-accent-wash rounded flex items-center justify-center">
            <FileText className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h3 className="font-semibold text-text-primary">{cleanFilename(doc.filename)}</h3>
            <p className="text-sm text-text-tertiary">
              {doc.file_type?.toUpperCase()} • {doc.chunk_count} sections
            </p>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12 px-6 bg-white">
            <div className="text-sm text-text-tertiary">Loading content...</div>
          </div>
        ) : content ? (
          <div className="flex-1 overflow-y-auto px-6 py-6 bg-white">
            <div className="text-sm text-text-secondary leading-relaxed font-normal">
              <p className="whitespace-pre-wrap">
                {displayContent}
              </p>
            </div>
            {isTruncated && (
              <button
                onClick={() => setShowFull(!showFull)}
                className="mt-6 text-sm text-accent hover:text-accent-anchor font-medium"
              >
                {showFull ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        ) : (
          <div className="px-6 py-12 bg-white">
            <p className="text-sm text-text-tertiary">
              Content not available for this document.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
