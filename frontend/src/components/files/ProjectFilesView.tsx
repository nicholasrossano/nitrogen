'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  FileText,
  Download,
  Trash2,
  Loader2,
  Upload,
  Zap,
  FolderOpen,
} from 'lucide-react';
import { api, ProjectMaterial, GeneratedFile, ProjectFilesResponse } from '@/lib/api';

interface ProjectFilesViewProps {
  initiativeId: string;
  materials: ProjectMaterial[];
  onDeleteMaterial?: (materialId: string) => Promise<void>;
}

const FILE_TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  txt: 'TXT',
  csv: 'CSV',
  xlsx: 'XLSX',
  xls: 'XLS',
  png: 'PNG',
  jpg: 'JPG',
};

const EXPORT_FORMAT_LABELS: Record<string, string> = {
  docx: 'DOCX',
  xlsx: 'XLSX',
  pdf: 'PDF',
  csv: 'CSV',
};

function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function ProjectFilesView({
  initiativeId,
  materials,
  onDeleteMaterial,
}: ProjectFilesViewProps) {
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    try {
      const response: ProjectFilesResponse = await api.getProjectFiles(initiativeId);
      setGeneratedFiles(response.generated);
    } catch (err) {
      console.error('Failed to load project files:', err);
    } finally {
      setLoading(false);
    }
  }, [initiativeId]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleDownloadMaterial = async (mat: ProjectMaterial) => {
    setDownloadingId(mat.id);
    try {
      await api.downloadMaterial(mat.id, mat.filename);
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setDownloadingId(null);
    }
  };

  const safeFilename = (title: string, ext: string) =>
    `${title.replace(/[^a-z0-9_\-. ]/gi, '_').replace(/\s+/g, '_')}.${ext}`;

  const handleDownloadGenerated = async (file: GeneratedFile) => {
    if (!file.exportable) return;
    setDownloadingId(file.id);
    try {
      const ext = file.export_format ?? 'docx';
      const filename = safeFilename(file.title, ext);
      await api.downloadDeliverable(initiativeId, file.id, filename);
      // If this was an unexported memo, refresh so the row shows "Exported"
      if (file.output_type === 'memo' && !file.exported) loadFiles();
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDeleteGenerated = async (file: GeneratedFile) => {
    setDeletingId(file.id);
    // Optimistic removal
    setGeneratedFiles((prev) => prev.filter((f) => f.id !== file.id));
    try {
      await api.deleteGeneratedFile(initiativeId, file.id);
    } catch (err) {
      console.error('Delete failed:', err);
      // Rollback
      loadFiles();
    } finally {
      setDeletingId(null);
    }
  };

  const hasUploaded = materials.length > 0;
  const hasGenerated = generatedFiles.length > 0;
  const isEmpty = !hasUploaded && !hasGenerated && !loading;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Files</h1>
          <p className="text-sm text-text-tertiary mt-1">
            Uploaded project materials and generated outputs.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FolderOpen className="w-10 h-10 text-text-tertiary/50 mb-3" />
            <p className="text-sm text-text-secondary font-medium">No files yet</p>
            <p className="text-xs text-text-tertiary mt-1 max-w-xs">
              Upload project materials from the sidebar or generate deliverables to see them here.
            </p>
          </div>
        ) : (
          <>
            {/* Uploaded Section */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Upload className="w-4 h-4 text-text-tertiary" />
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  Uploaded
                </h2>
                {hasUploaded && (
                  <span className="text-[10px] text-text-tertiary bg-black/[0.04] rounded-full px-1.5 py-0.5">
                    {materials.length}
                  </span>
                )}
              </div>

              {hasUploaded ? (
                <div className="border border-divider rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-black/[0.02]">
                        <th className="text-left text-[11px] font-medium text-text-tertiary uppercase tracking-wide px-4 py-2.5">Name</th>
                        <th className="text-left text-[11px] font-medium text-text-tertiary uppercase tracking-wide px-4 py-2.5 w-20">Type</th>
                        <th className="text-left text-[11px] font-medium text-text-tertiary uppercase tracking-wide px-4 py-2.5 w-24">Size</th>
                        <th className="text-left text-[11px] font-medium text-text-tertiary uppercase tracking-wide px-4 py-2.5 w-28 whitespace-nowrap">Date</th>
                        <th className="text-center text-[11px] font-medium text-text-tertiary uppercase tracking-wide px-4 py-2.5 w-20">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-divider">
                      {materials.map((mat) => (
                        <tr key={mat.id}>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <FileText className="w-4 h-4 text-text-tertiary flex-shrink-0" />
                              <span className="text-text-primary truncate" title={mat.filename}>
                                {mat.filename}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-[10px] font-medium text-text-tertiary uppercase bg-black/[0.04] rounded px-1.5 py-0.5">
                              {FILE_TYPE_LABELS[mat.file_type] || mat.file_type}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-text-secondary">
                            {formatFileSize(mat.file_size)}
                          </td>
                          <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">
                            {formatDate(mat.created_at)}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1 justify-center">
                              <button
                                onClick={() => handleDownloadMaterial(mat)}
                                disabled={downloadingId === mat.id}
                                className="p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-black/[0.04] transition-colors"
                                title="Download"
                              >
                                {downloadingId === mat.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Download className="w-3.5 h-3.5" />
                                )}
                              </button>
                              {onDeleteMaterial && (
                                <button
                                  onClick={() => onDeleteMaterial(mat.id)}
                                  className="p-1 rounded text-text-tertiary hover:text-red-400 hover:bg-red-50 transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="border border-dashed border-divider rounded-lg px-4 py-6 text-center">
                  <p className="text-xs text-text-tertiary">
                    No uploaded files yet. Use the sidebar to upload project materials.
                  </p>
                </div>
              )}
            </section>

            {/* Generated Section */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 text-text-tertiary" />
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  Generated
                </h2>
                {hasGenerated && (
                  <span className="text-[10px] text-text-tertiary bg-black/[0.04] rounded-full px-1.5 py-0.5">
                    {generatedFiles.length}
                  </span>
                )}
              </div>

              {hasGenerated ? (
                <div className="border border-divider rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-black/[0.02]">
                        <th className="text-left text-[11px] font-medium text-text-tertiary uppercase tracking-wide px-4 py-2.5">Name</th>
                        <th className="text-left text-[11px] font-medium text-text-tertiary uppercase tracking-wide px-4 py-2.5 w-20">Type</th>
                        <th className="text-left text-[11px] font-medium text-text-tertiary uppercase tracking-wide px-4 py-2.5 w-24">Size</th>
                        <th className="text-left text-[11px] font-medium text-text-tertiary uppercase tracking-wide px-4 py-2.5 w-28 whitespace-nowrap">Date</th>
                        <th className="text-center text-[11px] font-medium text-text-tertiary uppercase tracking-wide px-4 py-2.5 w-20">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-divider">
                      {generatedFiles.map((file) => (
                        <tr key={file.id}>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <Zap className="w-4 h-4 text-accent flex-shrink-0" />
                              <span className="text-text-primary truncate">{file.title}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-[10px] font-medium text-text-tertiary uppercase bg-black/[0.04] rounded px-1.5 py-0.5">
                              {file.export_format
                                ? (EXPORT_FORMAT_LABELS[file.export_format] ?? file.export_format.toUpperCase())
                                : '—'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-text-secondary">
                            {formatFileSize(null)}
                          </td>
                          <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">
                            {formatDate(file.created_at)}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1 justify-center">
                              {file.exportable && (
                                <button
                                  onClick={() => handleDownloadGenerated(file)}
                                  disabled={downloadingId === file.id || deletingId === file.id}
                                  className="p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-black/[0.04] transition-colors disabled:opacity-40"
                                  title={`Export as ${file.export_format?.toUpperCase()}`}
                                >
                                  {downloadingId === file.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Download className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteGenerated(file)}
                                disabled={deletingId === file.id || downloadingId === file.id}
                                className="p-1 rounded text-text-tertiary hover:text-red-400 hover:bg-red-50 transition-colors disabled:opacity-40"
                                title="Delete"
                              >
                                {deletingId === file.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="border border-dashed border-divider rounded-lg px-4 py-6 text-center">
                  <p className="text-xs text-text-tertiary">
                    No generated files yet. Use the Generate tab to create deliverables.
                  </p>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
