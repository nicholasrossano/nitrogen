'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, FileText, Loader2 } from 'lucide-react';
import { api, type ProjectMaterial } from '@/lib/api';
import { CHAT_FLOATING_PANEL_CHROME } from '@/components/ui/chatSidebarLayout';

const MAX_FILES = 8;

function formatFileSize(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileTypeLabel(fileType: string): string {
  return fileType.replace(/_/g, ' ').toUpperCase();
}

interface ProjectFilesPanelProps {
  projectId: string | null;
  refreshKey?: number;
  onOpenFile?: (file: ProjectMaterial) => void;
  onViewAll?: () => void;
}

export function ProjectFilesPanel({
  projectId,
  refreshKey = 0,
  onOpenFile,
  onViewAll,
}: ProjectFilesPanelProps) {
  const [rows, setRows] = useState<ProjectMaterial[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setRows([]);
      return;
    }
    setLoading(true);
    api
      .getMaterials(projectId)
      .then((materials) => {
        const sorted = [...materials].sort(
          (a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''),
        );
        setRows(sorted.slice(0, MAX_FILES));
      })
      .catch(() => {
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [projectId, refreshKey]);

  if (!projectId) return null;

  return (
    <aside
      className={`flex flex-col min-h-0 max-h-[min(32vh,14rem)] overflow-hidden shrink-0 ${CHAT_FLOATING_PANEL_CHROME}`}
    >
      <div className="px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text-primary">Files</h2>
          {onViewAll ? (
          <button
            type="button"
            onClick={onViewAll}
            className="shrink-0 p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-black/[0.04]"
            aria-label="View all files"
            title="View all files"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-text-tertiary px-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <p className="px-1 text-xs text-text-secondary">
            No project files yet. Upload materials from the files page to build the data room.
          </p>
        ) : (
          <ul className="space-y-1.5">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onOpenFile?.(row)}
                    disabled={!onOpenFile}
                    className="flex w-full items-center gap-2 rounded-md border border-stroke-subtle bg-white px-2.5 py-2 text-left transition-colors hover:bg-surface-subtle disabled:cursor-default disabled:hover:bg-white"
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0 text-text-tertiary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-text-primary truncate" title={row.filename}>
                        {row.filename}
                      </p>
                      <p className="text-[10px] text-text-tertiary">
                        {fileTypeLabel(row.file_type)} · {formatFileSize(row.file_size)}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
