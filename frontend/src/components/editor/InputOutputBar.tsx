'use client';

import { useState, useRef } from 'react';
import { Plus, FileText, Upload, Loader2, Trash2, Map } from 'lucide-react';
import { EvidenceDoc, Initiative } from '@/lib/api';

interface InputOutputBarProps {
  initiative: Initiative;
  evidenceDocs: EvidenceDoc[];
  selectedItemId: string | null;
  onSelectItem: (id: string, type: 'input' | 'output') => void;
  onUploadEvidence: (file: File) => Promise<void>;
  onDeleteEvidence?: (evidenceId: string) => Promise<void>;
  loading?: boolean;
  showProjectPlan?: boolean;
  onToggleProjectPlan?: () => void;
}

export function InputOutputBar({
  initiative,
  evidenceDocs,
  selectedItemId,
  onSelectItem,
  onUploadEvidence,
  onDeleteEvidence,
  loading = false,
  showProjectPlan = false,
  onToggleProjectPlan,
}: InputOutputBarProps) {
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
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

  const handleDelete = async (e: React.MouseEvent, evidenceId: string) => {
    e.stopPropagation();
    if (!onDeleteEvidence) return;
    
    setDeleting(evidenceId);
    try {
      await onDeleteEvidence(evidenceId);
    } catch (error) {
      console.error('Failed to delete:', error);
    } finally {
      setDeleting(null);
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
                className="upload-btn"
              >
                <Upload className="w-4 h-4" />
                Upload documents
              </button>
            ) : (
              <>
                {evidenceDocs.map((doc) => (
                  <div key={doc.id} className="relative group">
                    <button
                      onClick={() => onSelectItem(doc.id, 'input')}
                      className={`pill-btn ${selectedItemId === doc.id ? 'selected' : ''}`}
                      disabled={deleting === doc.id}
                    >
                      <FileText className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate max-w-[120px]">{doc.filename || 'Document'}</span>
                    </button>
                    {onDeleteEvidence && (
                      <button
                        onClick={(e) => handleDelete(e, doc.id)}
                        disabled={deleting === doc.id}
                        className="project-action-btn project-action-btn-danger absolute -top-1 -right-1 p-1 rounded opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-indicator-orange transition-opacity bg-surface-subtle border border-stroke-subtle shadow-sm"
                        title="Delete document"
                      >
                        {deleting === doc.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading || uploading}
                  className="upload-btn w-9 h-9 justify-center"
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
        {(hasOutputs || onToggleProjectPlan) && (
          <>
            {/* Divider */}
            <div className="w-px bg-divider" />

            {/* Outputs section */}
            <div className="flex-1 min-w-0 px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                  Outputs
                </h3>
                {onToggleProjectPlan && (
                  <button
                    onClick={onToggleProjectPlan}
                    className={`pill-btn !px-2.5 !py-1.5 !text-xs ${showProjectPlan ? 'selected' : ''}`}
                  >
                    <Map className="w-3.5 h-3.5" />
                    Project Plan
                  </button>
                )}
              </div>
              {hasOutputs && (
                <div className="flex items-center gap-2 flex-wrap">
                  {outputs.map((output) => (
                    <button
                      key={output.id}
                      onClick={() => onSelectItem(output.id, 'output')}
                      className={`pill-btn ${selectedItemId === output.id && !showProjectPlan ? 'selected' : ''}`}
                    >
                      <FileText className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate max-w-[120px]">{output.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
