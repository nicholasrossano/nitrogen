'use client';

import { useState, useRef, useCallback } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { Upload, FileText, Loader2, ClipboardPaste } from 'lucide-react';
import { PanelHeader } from '@/components/ui';
import { DuplicateFileDialog, DuplicateEntry } from '@/components/ui/DuplicateFileDialog';
import {
  extractFilesFromDrop,
  filterSupportedFiles,
  checkDuplicates,
  SUPPORTED_EXTENSIONS,
  runWithConcurrency,
  DEFAULT_UPLOAD_CONCURRENCY,
} from '@/lib/fileUtils';

interface EvidenceInputWidgetProps {
  initiativeId: string;
  isActive?: boolean;
}

export function EvidenceInputWidget({ initiativeId, isActive = true }: EvidenceInputWidgetProps) {
  const [mode, setMode] = useState<'upload' | 'paste'>('upload');
  const [pasteText, setPasteText] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { uploadEvidence, pasteEvidence, loading, projectMaterials } = useInitiativeStore();

  const [pendingDuplicates, setPendingDuplicates] = useState<{
    entries: DuplicateEntry[];
    filesToUpload: File[];
    cleanCount: number;
  } | null>(null);

  const doUpload = useCallback(async (filesToUpload: File[]) => {
    await runWithConcurrency(
      filesToUpload,
      DEFAULT_UPLOAD_CONCURRENCY,
      async (file) => {
        try {
          await uploadEvidence(initiativeId, file);
        } catch (err) {
          console.error('Failed to upload evidence:', file.name, err);
        }
      },
    );
  }, [initiativeId, uploadEvidence]);

  const handleFiles = async (files: File[]) => {
    const { accepted, rejected } = filterSupportedFiles(files);
    if (rejected.length > 0) {
      alert(`Skipped unsupported files:\n${rejected.join('\n')}\n\nAccepted: PDF, DOCX, XLSX, XLS`);
    }
    if (accepted.length === 0) return;

    const existingNames = projectMaterials.map((m) => m.filename);
    const results = checkDuplicates(accepted, existingNames);
    const duplicates = results.filter((r) => r.isDuplicate);
    const clean = results.filter((r) => !r.isDuplicate).map((r) => r.file);

    if (duplicates.length > 0) {
      const renamedDuplicates = duplicates.map(
        (r) => new File([r.file], r.newName, { type: r.file.type }),
      );
      setPendingDuplicates({
        entries: duplicates.map((d) => ({ original: d.file.name, renamed: d.newName })),
        filesToUpload: renamedDuplicates,
        cleanCount: clean.length,
      });
      if (clean.length > 0) doUpload(clean);
    } else {
      doUpload(accepted);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const files = await extractFilesFromDrop(e.dataTransfer);
    if (files.length > 0) handleFiles(files);
  };

  const handlePasteSubmit = async () => {
    if (!pasteText.trim()) return;
    await pasteEvidence(initiativeId, pasteText, pasteTitle || undefined);
  };

  return (
    <div className="card-elevated overflow-hidden">
      <PanelHeader
        icon={FileText}
        title="Add Evidence"
        subtitle="Upload a document or paste text"
      />

      {/* Mode tabs */}
      <div className="flex border-b border-divider bg-white">
        <button
          onClick={() => setMode('upload')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors duration-150 ${
            mode === 'upload' 
              ? 'text-accent border-b border-accent bg-accent-wash/30' 
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-subtle'
          }`}
        >
          <Upload className="w-4 h-4 inline mr-2" />
          Upload File
        </button>
        <button
          onClick={() => setMode('paste')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors duration-150 ${
            mode === 'paste' 
              ? 'text-accent border-b border-accent bg-accent-wash/30' 
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-subtle'
          }`}
        >
          <ClipboardPaste className="w-4 h-4 inline mr-2" />
          Paste Text
        </button>
      </div>

      {/* Content - only show interactive parts when active */}
      {isActive && (
        <div className="p-5 bg-white">
          {mode === 'upload' ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
              border border-dashed rounded p-10 text-center cursor-pointer transition-colors duration-150
              ${dragActive 
                ? 'border-accent bg-accent-wash/30' 
                : 'border-stroke-subtle hover:border-accent hover:bg-surface-subtle'
              }
              ${loading ? 'pointer-events-none opacity-50' : ''}
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={SUPPORTED_EXTENSIONS}
              multiple
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleFiles(Array.from(e.target.files));
                  e.target.value = '';
                }
              }}
              className="hidden"
            />
            
            {loading ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-10 h-10 text-accent animate-spin" />
                <p className="text-sm text-text-secondary font-medium">Processing document...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded bg-accent-wash flex items-center justify-center">
                  <FileText className="w-6 h-6 text-accent" />
                </div>
                <p className="text-sm font-medium text-text-primary">
                  Drop files or a folder, or click to browse
                </p>
                <p className="text-sm text-text-tertiary">
                  PDF, DOCX, or Excel · multiple files supported
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <input
              type="text"
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              placeholder="Document title (optional)"
              disabled={loading}
              className="input-field"
            />
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste your evidence text here..."
              disabled={loading}
              rows={6}
              className="input-field resize-none"
            />
            <button
              onClick={handlePasteSubmit}
              disabled={loading || !pasteText.trim()}
              className="btn-primary w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4" />
                  Add Text as Evidence
                </>
              )}
            </button>
          </div>
          )}
        </div>
      )}
      
      {/* Show completed state when not active */}
      {!isActive && (
        <div className="p-5 bg-white text-center">
          <p className="text-sm text-text-secondary">Evidence uploaded</p>
        </div>
      )}

      {pendingDuplicates && (
        <DuplicateFileDialog
          duplicates={pendingDuplicates.entries}
          cleanCount={pendingDuplicates.cleanCount}
          onConfirm={(selectedOriginals) => {
            const selected = new Set(selectedOriginals);
            const files = pendingDuplicates.filesToUpload.filter((_, i) =>
              selected.has(pendingDuplicates.entries[i].original),
            );
            setPendingDuplicates(null);
            if (files.length > 0) doUpload(files);
          }}
          onCancel={() => setPendingDuplicates(null)}
        />
      )}
    </div>
  );
}
