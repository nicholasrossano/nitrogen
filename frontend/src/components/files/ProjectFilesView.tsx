'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  FileText,
  Download,
  Trash2,
  Loader2,
  Upload,
  Zap,
  FolderOpen,
  RefreshCw,
  ChevronDown,
} from 'lucide-react';

type TabType = 'uploaded' | 'generated';
import { api, ProjectMaterial, GeneratedFile, ProjectFilesResponse, DriveLinkedFile } from '@/lib/api';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  dataTableContainerClass,
  dataTableHeaderCellClass,
  dataTableTableClass,
  dataTableHeaderRowClass,
  dataTableBodyClass,
  dataTablePaginationButtonClass,
} from '@/components/ui/ReadOnlyDataTable';
import {
  filterSupportedFiles,
  SUPPORTED_EXTENSIONS,
  runWithConcurrency,
  DEFAULT_UPLOAD_CONCURRENCY,
} from '@/lib/fileUtils';

interface ProjectFilesViewProps {
  initiativeId?: string;
  scope?: 'project' | 'workspace';
  title?: string;
  description?: string;
  materials: ProjectMaterial[];
  onDeleteMaterial?: (materialId: string) => Promise<void>;
  onUploadFile?: (file: File) => Promise<void>;
  onImportFromDrive?: () => Promise<void>;
  driveLinkedFiles?: DriveLinkedFile[];
  onSyncDriveFiles?: () => Promise<void>;
}

const FILE_TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  txt: 'TXT',
  csv: 'CSV',
  xlsx: 'XLSX',
  xls: 'XLS',
  pptx: 'PPTX',
  png: 'PNG',
  jpg: 'JPG',
  template_docx: 'Template',
  template_xlsx: 'Template',
};

const EXPORT_FORMAT_LABELS: Record<string, string> = {
  docx: 'DOCX',
  xlsx: 'XLSX',
  pptx: 'PPTX',
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
  scope = 'project',
  title,
  description,
  materials,
  onDeleteMaterial,
  onUploadFile,
  onImportFromDrive,
  driveLinkedFiles = [],
  onSyncDriveFiles,
}: ProjectFilesViewProps) {
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('uploaded');
  const [uploadedPage, setUploadedPage] = useState(1);
  const [generatedPage, setGeneratedPage] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ updated: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [driveImporting, setDriveImporting] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadMenuRef = useRef<HTMLDivElement>(null);

  // Set of evidence_doc_ids that are linked to Drive (for badge display)
  const driveLinkedIds = new Set(
    driveLinkedFiles.map((l) => l.evidence_doc_id).filter(Boolean) as string[]
  );

  const PAGE_SIZE = 20;

  const loadFiles = useCallback(async () => {
    if (scope === 'workspace' || !initiativeId) {
      setGeneratedFiles([]);
      setLoading(false);
      return;
    }
    try {
      const response: ProjectFilesResponse = await api.getProjectFiles(initiativeId);
      setGeneratedFiles(response.generated);
    } catch (err) {
      console.error('Failed to load project files:', err);
    } finally {
      setLoading(false);
    }
  }, [initiativeId, scope]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleDownloadMaterial = async (mat: ProjectMaterial) => {
    setDownloadingId(mat.id);
    try {
      if (mat.source === 'evidence') {
        await api.downloadEvidence(mat.id, mat.filename);
      } else {
        await api.downloadMaterial(mat.id, mat.filename);
      }
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setDownloadingId(null);
    }
  };

  const safeFilename = (title: string, ext: string) =>
    `${title.replace(/[^a-z0-9_\-. ]/gi, '_').replace(/\s+/g, '_')}.${ext}`;

  const handleDownloadGenerated = async (file: GeneratedFile) => {
    if (!file.exportable || !initiativeId) return;
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
    if (!initiativeId) return;
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

  const handleSyncDrive = useCallback(async () => {
    if (!onSyncDriveFiles) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      await onSyncDriveFiles();
      setSyncResult({ updated: 1 }); // result detail handled in store
    } catch (err) {
      console.error('Drive sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }, [onSyncDriveFiles]);

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUploadFile) return;
    e.target.value = '';
    setUploading(true);
    try {
      await onUploadFile(file);
    } finally {
      setUploading(false);
    }
  }, [onUploadFile]);

  const handleFolderInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!onUploadFile) return;
    const all = Array.from(e.target.files ?? []);
    e.target.value = '';
    const { accepted, rejected } = filterSupportedFiles(all);
    if (rejected.length > 0) console.warn('Skipped unsupported files:', rejected.join(', '));
    if (accepted.length === 0) return;
    setUploading(true);
    try {
      await runWithConcurrency(
        accepted,
        DEFAULT_UPLOAD_CONCURRENCY,
        async (file) => {
          try {
            await onUploadFile(file);
          } catch (err) {
            console.error('Failed to upload file:', file.name, err);
          }
        },
      );
    } finally {
      setUploading(false);
    }
  }, [onUploadFile]);

  useEffect(() => {
    if (!uploadMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!uploadMenuRef.current?.contains(e.target as Node)) setUploadMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [uploadMenuOpen]);

  const handleDriveImport = useCallback(async () => {
    if (!onImportFromDrive) return;
    setDriveImporting(true);
    try {
      await onImportFromDrive();
    } catch (err) {
      console.error('Drive import failed:', err);
    } finally {
      setDriveImporting(false);
    }
  }, [onImportFromDrive]);

  const hasUploaded = materials.length > 0;
  const hasGenerated = generatedFiles.length > 0;
  const showGeneratedTab = scope === 'project';
  const actionButtonClass = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-secondary bg-surface-subtle ring-1 ring-inset ring-black/[0.08] enabled:hover:bg-black/[0.07] disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

  const uploadedTotalPages = Math.max(1, Math.ceil(materials.length / PAGE_SIZE));
  const generatedTotalPages = Math.max(1, Math.ceil(generatedFiles.length / PAGE_SIZE));
  const pagedMaterials = materials.slice((uploadedPage - 1) * PAGE_SIZE, uploadedPage * PAGE_SIZE);
  const pagedGenerated = generatedFiles.slice((generatedPage - 1) * PAGE_SIZE, generatedPage * PAGE_SIZE);

  const thClass = dataTableHeaderCellClass;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-10">

        {/* Header + Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">{title ?? (scope === 'workspace' ? 'Workspace files' : 'Project files')}</h1>
            <p className="text-sm text-text-tertiary mt-1">
              {description ?? (
                scope === 'workspace'
                  ? 'Shared guidance and reusable context for this workspace.'
                  : 'Uploaded project materials and generated outputs.'
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {driveLinkedFiles.length > 0 && onSyncDriveFiles && (
              <Tooltip content="Updates linked files with latest versions from Google Drive.">
                <button
                  onClick={handleSyncDrive}
                  disabled={syncing}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-secondary bg-surface-subtle ring-1 ring-inset ring-black/[0.08] enabled:hover:bg-black/[0.07] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">Sync Drive</span>
                </button>
              </Tooltip>
            )}
            {showGeneratedTab && (
            <div className="flex items-center bg-black/[0.04] rounded-lg p-0.5 ring-1 ring-inset ring-black/[0.08]">
              {(['uploaded', 'generated'] as TabType[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1 rounded-[5px] text-xs font-medium transition-colors ${
                    activeTab === tab
                      ? 'bg-white text-text-primary shadow-sm'
                      : 'text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  {tab === 'uploaded' ? 'Uploaded' : 'Generated'}
                </button>
              ))}
            </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
          </div>
        ) : activeTab === 'uploaded' ? (
          <div className="space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={SUPPORTED_EXTENSIONS}
              multiple
              onChange={handleFileInputChange}
            />
            <input
              ref={folderInputRef}
              type="file"
              className="hidden"
              multiple
              onChange={handleFolderInputChange}
              {...{ webkitdirectory: '' }}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-text-tertiary" />
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {scope === 'workspace' ? 'Workspace files' : 'Uploaded'}
                </h2>
              </div>
              {(onUploadFile || onImportFromDrive) && (
                <div className="flex items-center gap-1.5">
                  {onUploadFile && (
                    <div ref={uploadMenuRef} className="relative">
                      <button
                        onClick={() => setUploadMenuOpen((o) => !o)}
                        disabled={uploading}
                        className={actionButtonClass}
                      >
                        {uploading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Upload className="w-3.5 h-3.5" />
                        )}
                        <span>Upload</span>
                        <ChevronDown className="w-3 h-3 opacity-60" />
                      </button>
                      {uploadMenuOpen && (
                        <div className="absolute right-0 top-full mt-1 z-20 min-w-[140px] bg-white rounded-lg shadow-lg border border-gray-100 py-1 text-xs">
                          <button
                            onClick={() => { fileInputRef.current?.click(); setUploadMenuOpen(false); }}
                            className="flex items-center gap-2 w-full px-3 py-2 text-text-secondary hover:bg-black/[0.04] transition-colors"
                          >
                            <Upload className="w-3.5 h-3.5 flex-shrink-0" />
                            Files
                          </button>
                          <button
                            onClick={() => { folderInputRef.current?.click(); setUploadMenuOpen(false); }}
                            className="flex items-center gap-2 w-full px-3 py-2 text-text-secondary hover:bg-black/[0.04] transition-colors"
                          >
                            <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" />
                            Folder
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {onImportFromDrive && (
                    <button
                      onClick={handleDriveImport}
                      disabled={driveImporting}
                      className={actionButtonClass}
                    >
                      {driveImporting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                          <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                          <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
                          <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
                          <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                          <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                          <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 27.5h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                        </svg>
                      )}
                      <span>Import from Drive</span>
                    </button>
                  )}
                </div>
              )}
            </div>
            {hasUploaded ? (
            <>
            <div className={dataTableContainerClass}>
              <div className="overflow-x-auto">
              <table className={dataTableTableClass}>
                <thead>
                  <tr className={dataTableHeaderRowClass}>
                    <th className={thClass}>Name</th>
                    <th className={`${thClass} w-20`}>Type</th>
                    <th className={`${thClass} w-24`}>Size</th>
                    <th className={`${thClass} w-28 whitespace-nowrap`}>Date</th>
                    <th className={`${thClass} w-20 text-center`}>Actions</th>
                  </tr>
                </thead>
                <tbody className={dataTableBodyClass}>
                  {pagedMaterials.map((mat) => {
                    const isDrive = driveLinkedIds.has(mat.id);
                    return (
                    <tr key={mat.id}>
                      <td className="px-4 py-2.5 max-w-0 w-full">
                        <div className="flex items-center gap-2 min-w-0">
                          {isDrive ? (
                            <svg className="w-4 h-4 flex-shrink-0 text-[#4285F4]" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg" aria-label="Google Drive">
                              <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                              <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
                              <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
                              <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                              <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                              <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 27.5h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                            </svg>
                          ) : (
                            <FileText className="w-4 h-4 text-text-tertiary flex-shrink-0" />
                          )}
                          <span className="text-text-primary truncate min-w-0" title={mat.filename}>
                            {mat.filename}
                          </span>
                          <span className="text-[9px] font-medium text-text-tertiary bg-black/[0.04] rounded px-1 py-0.5 flex-shrink-0">
                            {scope === 'workspace' ? 'Workspace' : 'Project'}
                          </span>
                          {isDrive && (
                            <span className="text-[9px] font-medium text-[#4285F4] bg-[#4285F4]/10 rounded px-1 py-0.5 flex-shrink-0">
                              Drive
                            </span>
                          )}
                          {(mat.processing_status === 'uploaded' ||
                            mat.processing_status === 'processing' ||
                            mat.processing_status === 'lightweight_ready') && (
                            <span
                              className="flex items-center gap-1 text-[10px] font-medium text-text-tertiary bg-black/[0.04] rounded px-1.5 py-0.5 flex-shrink-0"
                              title="Processing in background — file is usable, retrieval will improve once indexing finishes."
                            >
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              Processing
                            </span>
                          )}
                          {mat.processing_status === 'failed' && (
                            <span
                              className="text-[10px] font-medium text-red-500 bg-red-50 rounded px-1.5 py-0.5 flex-shrink-0"
                              title={mat.processing_error || 'Processing failed'}
                            >
                              Failed
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[10px] font-medium text-text-tertiary uppercase bg-black/[0.04] rounded px-1.5 py-0.5">
                          {FILE_TYPE_LABELS[mat.file_type] || mat.file_type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">
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
                          {onDeleteMaterial ? (
                            <button
                              onClick={() => onDeleteMaterial(mat.id)}
                              className="p-1 rounded text-text-tertiary hover:text-red-400 hover:bg-red-50 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <div className="p-1 w-[22px]" />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
              </div>
            </div>
            {uploadedTotalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-text-tertiary">
                  {(uploadedPage - 1) * PAGE_SIZE + 1}–{Math.min(uploadedPage * PAGE_SIZE, materials.length)} of {materials.length}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setUploadedPage((p) => Math.max(1, p - 1))}
                    disabled={uploadedPage === 1}
                    className={dataTablePaginationButtonClass}
                  >
                    Previous
                  </button>
                  <span className="text-xs text-text-tertiary px-1">{uploadedPage} / {uploadedTotalPages}</span>
                  <button
                    onClick={() => setUploadedPage((p) => Math.min(uploadedTotalPages, p + 1))}
                    disabled={uploadedPage === uploadedTotalPages}
                    className={dataTablePaginationButtonClass}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FolderOpen className="w-10 h-10 text-text-tertiary/50 mb-3" />
              <p className="text-sm text-text-secondary font-medium">No uploaded files yet</p>
              <p className="text-xs text-text-tertiary mt-1 max-w-xs">
                {scope === 'workspace'
                  ? 'Upload shared guidance documents for this workspace.'
                  : 'Use the sidebar to upload project materials.'}
              </p>
            </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-text-tertiary" />
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Generated</h2>
            </div>
            {hasGenerated ? (
            <>
            <div className={dataTableContainerClass}>
              <div className="overflow-x-auto">
              <table className={dataTableTableClass}>
                <thead>
                  <tr className={dataTableHeaderRowClass}>
                    <th className={thClass}>Name</th>
                    <th className={`${thClass} w-20`}>Type</th>
                    <th className={`${thClass} w-24`}>Size</th>
                    <th className={`${thClass} w-28 whitespace-nowrap`}>Date</th>
                    <th className={`${thClass} w-20 text-center`}>Actions</th>
                  </tr>
                </thead>
                <tbody className={dataTableBodyClass}>
                  {pagedGenerated.map((file) => (
                    <tr key={file.id}>
                      <td className="px-4 py-2.5 max-w-0 w-full">
                        <div className="flex items-center gap-2 min-w-0">
                          <Zap className="w-4 h-4 text-text-tertiary flex-shrink-0" />
                          <span className="text-text-primary truncate min-w-0">{file.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[10px] font-medium text-text-tertiary uppercase bg-black/[0.04] rounded px-1.5 py-0.5">
                          {file.export_format
                            ? (EXPORT_FORMAT_LABELS[file.export_format] ?? file.export_format.toUpperCase())
                            : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">
                        {formatFileSize(null)}
                      </td>
                      <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">
                        {formatDate(file.created_at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1 justify-center">
                          {file.exportable ? (
                            <button
                              onClick={() => handleDownloadGenerated(file)}
                              disabled={downloadingId === file.id || deletingId === file.id}
                              className="p-1 rounded text-text-tertiary enabled:hover:text-text-secondary enabled:hover:bg-black/[0.04] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              title={`Export as ${file.export_format?.toUpperCase()}`}
                            >
                              {downloadingId === file.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Download className="w-3.5 h-3.5" />
                              )}
                            </button>
                          ) : (
                            <div className="p-1 w-[22px]" />
                          )}
                          <button
                            onClick={() => handleDeleteGenerated(file)}
                            disabled={deletingId === file.id || downloadingId === file.id}
                            className="p-1 rounded text-text-tertiary enabled:hover:text-red-400 enabled:hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
            </div>
            {generatedTotalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-text-tertiary">
                  {(generatedPage - 1) * PAGE_SIZE + 1}–{Math.min(generatedPage * PAGE_SIZE, generatedFiles.length)} of {generatedFiles.length}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setGeneratedPage((p) => Math.max(1, p - 1))}
                    disabled={generatedPage === 1}
                    className={dataTablePaginationButtonClass}
                  >
                    Previous
                  </button>
                  <span className="text-xs text-text-tertiary px-1">{generatedPage} / {generatedTotalPages}</span>
                  <button
                    onClick={() => setGeneratedPage((p) => Math.min(generatedTotalPages, p + 1))}
                    disabled={generatedPage === generatedTotalPages}
                    className={dataTablePaginationButtonClass}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Zap className="w-10 h-10 text-text-tertiary/50 mb-3" />
              <p className="text-sm text-text-secondary font-medium">No generated files yet</p>
              <p className="text-xs text-text-tertiary mt-1 max-w-xs">
                Use the Generate tab to create deliverables.
              </p>
            </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
