'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FileUp, Upload, X, FileSpreadsheet, FileText } from 'lucide-react';
import { api } from '@/lib/api';

const ACCEPTED_TYPES: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

const ACCEPTED_EXTENSIONS = ['.docx', '.xlsx'];

interface RecentTemplate {
  template_id: string;
  filename: string;
  file_type: string;
  created_at: string;
}

interface TemplateUploadInterstitialProps {
  onUpload: (file: File) => void;
  onCancel: () => void;
  uploading?: boolean;
  initiativeId?: string;
  onSelectRecent?: (templateId: string, filename: string) => void;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs === 1 ? '1h ago' : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

export function TemplateUploadInterstitial({
  onUpload,
  onCancel,
  uploading = false,
  initiativeId,
  onSelectRecent,
}: TemplateUploadInterstitialProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [recentTemplates, setRecentTemplates] = useState<RecentTemplate[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (!initiativeId) return;
    api.getRecentTemplates(initiativeId).then(setRecentTemplates).catch(() => {});
  }, [initiativeId]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !uploading) onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel, uploading]);

  const validateFile = useCallback((f: File): boolean => {
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext) && !ACCEPTED_TYPES[f.type]) {
      setError('Only DOCX and XLSX files are supported.');
      return false;
    }
    setError(null);
    return true;
  }, []);

  const handleFile = useCallback(
    (f: File) => {
      if (validateFile(f)) setFile(f);
    },
    [validateFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) handleFile(dropped);
    },
    [handleFile],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) handleFile(selected);
  };

  const fileIcon = file?.name.endsWith('.xlsx') ? (
    <FileSpreadsheet className="w-5 h-5 text-green-600" />
  ) : (
    <FileText className="w-5 h-5 text-accent" />
  );

  const recentIcon = (t: RecentTemplate) =>
    t.file_type === 'template_xlsx' ? (
      <FileSpreadsheet className="w-3.5 h-3.5 text-green-600 shrink-0" />
    ) : (
      <FileText className="w-3.5 h-3.5 text-accent shrink-0" />
    );

  const modal = (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !uploading) onCancel();
      }}
    >
      {/* Panel */}
      <div className="relative w-full max-w-md mx-4 rounded-2xl bg-white shadow-2xl border border-stroke-subtle">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-stroke-subtle">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
              <FileUp className="w-3.5 h-3.5 text-accent" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Generate from Template</h2>
              <p className="text-[11px] text-text-tertiary mt-0.5">DOCX or XLSX</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={uploading}
            className="p-1 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <p className="text-[13px] text-text-secondary leading-relaxed">
            Upload a document or spreadsheet you need completed. We&apos;ll analyze what it
            requires and fill it from your existing project materials, surfacing anything
            that&apos;s missing.
          </p>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={[
              'flex flex-col items-center justify-center gap-3 px-6 py-8 rounded-xl border-2 border-dashed cursor-pointer transition-colors duration-150',
              dragOver
                ? 'border-accent bg-accent/[0.06]'
                : file
                  ? 'border-stroke-muted bg-surface-subtle'
                  : 'border-stroke-subtle hover:border-accent/40 hover:bg-accent/[0.03]',
            ].join(' ')}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".docx,.xlsx"
              className="hidden"
              onChange={handleInputChange}
            />

            {file ? (
              <div className="flex items-center gap-3">
                {fileIcon}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate max-w-[220px]">
                    {file.name}
                  </p>
                  <p className="text-xs text-text-tertiary">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    setError(null);
                    if (inputRef.current) inputRef.current.value = '';
                  }}
                  className="p-1 rounded hover:bg-white transition-colors text-text-tertiary hover:text-text-secondary"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <Upload className="w-5 h-5 text-text-tertiary" />
                <div className="text-center">
                  <p className="text-sm text-text-secondary">
                    Drop a file here, or <span className="text-accent font-medium">browse</span>
                  </p>
                  <p className="text-xs text-text-tertiary mt-0.5">DOCX or XLSX</p>
                </div>
              </>
            )}
          </div>

          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

          {/* Recent Templates */}
          {recentTemplates.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-2">
                Recent Templates
              </p>
              <div className="space-y-1">
                {recentTemplates.map((t) => (
                  <button
                    key={t.template_id}
                    type="button"
                    disabled={uploading}
                    onClick={() => onSelectRecent?.(t.template_id, t.filename)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-surface-subtle transition-colors disabled:opacity-40"
                  >
                    {recentIcon(t)}
                    <span className="flex-1 min-w-0 text-xs font-medium text-text-primary truncate">
                      {t.filename}
                    </span>
                    <span className="text-[11px] text-text-tertiary shrink-0">
                      {formatRelativeTime(t.created_at)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={uploading}
            className="px-3.5 py-1.5 text-xs font-medium text-text-secondary rounded-lg border border-stroke-subtle hover:bg-surface-subtle transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => file && onUpload(file)}
            disabled={!file || uploading}
            className="px-3.5 py-1.5 text-xs font-medium text-white rounded-lg bg-accent hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-default flex items-center gap-1.5"
          >
            {uploading ? (
              <>
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Analyzing...
              </>
            ) : (
              'Continue'
            )}
          </button>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modal, document.body);
}
