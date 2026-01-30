'use client';

import { useState, useRef } from 'react';
import { Plus, FileText, Upload, Loader2 } from 'lucide-react';
import { EvidenceDoc, Initiative } from '@/lib/api';

interface InputOutputBarProps {
  initiative: Initiative;
  evidenceDocs: EvidenceDoc[];
  selectedItemId: string | null;
  onSelectItem: (id: string, type: 'input' | 'output') => void;
  onUploadEvidence: (file: File) => Promise<void>;
  loading?: boolean;
}

export function InputOutputBar({
  initiative,
  evidenceDocs,
  selectedItemId,
  onSelectItem,
  onUploadEvidence,
  loading = false,
}: InputOutputBarProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      await onUploadEvidence(file);
    } catch (error) {
      console.error('Failed to upload:', error);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Get outputs from deliverables
  const outputs = initiative.deliverables 
    ? Object.entries(initiative.deliverables).map(([id, data]: [string, any]) => ({
        id,
        name: data.title || data.name || id,
        type: data.widget_type || 'document',
      }))
    : [];

  const hasOutputs = outputs.length > 0;

  return (
    <div className="flex-shrink-0 bg-white border-b border-divider">
      <div className="flex items-stretch">
        {/* Inputs section */}
        <div className="flex-1 min-w-0 px-4 py-3">
          <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
            Inputs
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            {evidenceDocs.length === 0 && !uploading ? (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-2 border border-dashed border-stroke-subtle rounded hover:border-accent hover:bg-accent-wash/30 transition-colors text-sm text-text-secondary"
              >
                <Upload className="w-4 h-4" />
                Upload documents
              </button>
            ) : (
              <>
                {evidenceDocs.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => onSelectItem(doc.id, 'input')}
                    className={`
                      flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors
                      ${selectedItemId === doc.id
                        ? 'bg-accent-wash border border-stroke-accent text-accent-anchor'
                        : 'bg-surface-grey border border-transparent text-text-primary hover:border-stroke-subtle'
                      }
                    `}
                  >
                    <FileText className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate max-w-[120px]">{doc.filename || 'Document'}</span>
                  </button>
                ))}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading || uploading}
                  className="w-9 h-9 flex items-center justify-center border border-dashed border-stroke-subtle rounded hover:border-accent hover:bg-accent-wash/30 transition-colors text-text-tertiary"
                >
                  {uploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Divider and Outputs section */}
        {hasOutputs && (
          <>
            {/* Divider */}
            <div className="w-px bg-divider" />

            {/* Outputs section */}
            <div className="flex-1 min-w-0 px-4 py-3">
              <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">
                Outputs
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                {outputs.map((output) => (
                  <button
                    key={output.id}
                    onClick={() => onSelectItem(output.id, 'output')}
                    className={`
                      flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors
                      ${selectedItemId === output.id
                        ? 'bg-accent-wash border border-stroke-accent text-accent-anchor'
                        : 'bg-surface-grey border border-transparent text-text-primary hover:border-stroke-subtle'
                      }
                    `}
                  >
                    <FileText className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate max-w-[120px]">{output.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
