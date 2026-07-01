'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookMarked, CheckCircle2, Database, FileText, HelpCircle, Pencil, Plus, RefreshCw, Trash2, Wrench, XCircle } from 'lucide-react';
import {
  api,
  type ProjectStatusAssessmentReference,
  type ProjectStatusCategoryConfig,
  type ProjectStatusCategoryRow,
  type ProjectStatusLevel,
  type ProjectStatusResponse,
  type ProjectStatusSourceReference,
} from '@/lib/api';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import { StatusCategoryEditorModal } from '@/components/project-status/StatusCategoryEditorModal';

const STATUS_META: Record<ProjectStatusLevel, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  green: {
    label: 'Green',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    Icon: CheckCircle2,
  },
  yellow: {
    label: 'Yellow',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
    Icon: AlertTriangle,
  },
  red: {
    label: 'Red',
    className: 'border-red-200 bg-red-50 text-red-700',
    Icon: XCircle,
  },
  unknown: {
    label: 'Unknown',
    className: 'border-slate-200 bg-slate-100 text-slate-600',
    Icon: HelpCircle,
  },
};

const CONFIDENCE_META = {
  high: { bg: 'bg-green-50', text: 'text-green-700', icon: CheckCircle2 },
  medium: { bg: 'bg-yellow-50', text: 'text-yellow-700', icon: AlertTriangle },
  low: { bg: 'bg-red-50', text: 'text-red-700', icon: AlertTriangle },
  unknown: { bg: 'bg-slate-100', text: 'text-slate-600', icon: HelpCircle },
} as const;

function sourceLabel(sourceType: string): string {
  const normalized = sourceType.toLowerCase();
  if (normalized.includes('workspace')) return 'Workspace';
  if (normalized.includes('project_material')) return 'Material';
  if (normalized.includes('evidence')) return 'Document';
  if (normalized.includes('corpus')) return 'Corpus';
  return 'Source';
}

function sourceIcon(sourceType: string) {
  const normalized = sourceType.toLowerCase();
  if (normalized.includes('workspace')) return <Database className="h-2.5 w-2.5 shrink-0" />;
  if (normalized.includes('project_material')) return <FileText className="h-2.5 w-2.5 shrink-0" />;
  if (normalized.includes('evidence') || normalized.includes('corpus')) return <FileText className="h-2.5 w-2.5 shrink-0" />;
  return <FileText className="h-2.5 w-2.5 shrink-0" />;
}

function StatusSourcesMenu({
  sources,
  assessments,
  onOpenDocument,
  onOpenAssessment,
}: {
  sources: ProjectStatusSourceReference[];
  assessments: ProjectStatusAssessmentReference[];
  onOpenDocument?: (citation: ResearchPanelCitation) => void;
  onOpenAssessment?: (assessment: {
    instanceId: string;
    assessmentId: string;
    title?: string | null;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  if (sources.length === 0 && assessments.length === 0) return null;
  const showSectionDivider = sources.length > 0 && assessments.length > 0;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`flex items-center gap-1 pl-1.5 pr-2 py-0.5 rounded transition-colors text-[11px] ${
          open ? 'text-accent bg-accent/[0.07]' : 'text-text-tertiary hover:text-text-primary'
        }`}
        aria-label="Sources"
        title="Sources"
      >
        <BookMarked className="w-3.5 h-3.5" />
        <span>Sources</span>
      </button>
      {open ? (
        <div className="absolute bottom-full right-0 mb-1.5 z-50 bg-white border border-stroke-subtle rounded-lg shadow-lg p-2 min-w-[250px] max-w-[360px]">
          <div className="space-y-0.5">
            {sources.map((source, index) => {
              const canOpenInternalDoc = Boolean(source.evidence_doc_id && onOpenDocument);
              return (
                <div key={`${source.source_title}-${index}`} className="flex items-center gap-2 min-w-0 rounded-md px-1.5 py-1 hover:bg-surface-subtle transition-colors">
                  <span className="text-text-tertiary shrink-0">{sourceIcon(source.source_type)}</span>
                  <span className="text-[10px] uppercase tracking-wide text-text-tertiary shrink-0 w-16">
                    {sourceLabel(source.source_type)}
                  </span>
                  {canOpenInternalDoc ? (
                    <button
                      type="button"
                      className="text-xs text-accent hover:underline truncate text-left"
                      title={source.citation || source.source_title}
                      onClick={() => {
                        onOpenDocument?.({
                          evidence_doc_id: source.evidence_doc_id!,
                          chunk_id: source.chunk_id ?? null,
                          source_title: source.source_title,
                        });
                        setOpen(false);
                      }}
                    >
                      {source.source_title}
                    </button>
                  ) : source.source_url ? (
                    <a
                      href={source.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent hover:underline truncate"
                      onClick={() => setOpen(false)}
                      title={source.citation || source.source_title}
                    >
                      {source.source_title}
                    </a>
                  ) : (
                    <span className="text-xs text-text-secondary truncate" title={source.citation || source.source_title}>
                      {source.source_title}
                    </span>
                  )}
                </div>
              );
            })}
            {assessments.length > 0 ? (
              <>
                {showSectionDivider ? <div className="my-1 border-t border-divider" /> : null}
                {assessments.map((assessment) => (
                  <div key={`${assessment.assessment_id}-${assessment.instance_id ?? assessment.display_name}`} className="flex items-center gap-2 min-w-0 rounded-md px-1.5 py-1 hover:bg-surface-subtle transition-colors">
                    <span className="text-text-tertiary shrink-0"><Wrench className="h-2.5 w-2.5 shrink-0" /></span>
                    <span className="text-[10px] uppercase tracking-wide text-text-tertiary shrink-0 w-16">Assessment</span>
                    {assessment.instance_id && onOpenAssessment ? (
                      <button
                        type="button"
                        className="text-xs text-accent hover:underline truncate text-left"
                        title={assessment.display_name}
                        onClick={() => {
                          onOpenAssessment({
                            instanceId: assessment.instance_id!,
                            assessmentId: assessment.assessment_id,
                            title: assessment.display_name,
                          });
                          setOpen(false);
                        }}
                      >
                        {assessment.display_name}
                      </button>
                    ) : (
                      <span className="text-xs text-text-secondary truncate" title={assessment.display_name}>
                        {assessment.display_name}
                      </span>
                    )}
                  </div>
                ))}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface StatusOverviewTableProps {
  initiativeId: string;
  readOnly?: boolean;
  hideRefreshButton?: boolean;
  refreshToken?: number;
  onOpenDocument?: (citation: ResearchPanelCitation) => void;
  onOpenWorkspaceAssessment?: (assessment: {
    instanceId: string;
    assessmentId: string;
    title?: string | null;
  }) => void;
}

export function StatusOverviewTable({
  initiativeId,
  readOnly = false,
  hideRefreshButton = false,
  refreshToken = 0,
  onOpenDocument,
  onOpenWorkspaceAssessment,
}: StatusOverviewTableProps) {
  const [statusData, setStatusData] = useState<ProjectStatusResponse | null>(null);
  const [categoryConfigs, setCategoryConfigs] = useState<ProjectStatusCategoryConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ProjectStatusCategoryConfig | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [response, configs] = await Promise.all([
        api.getProjectStatus(initiativeId),
        api.listStatusCategories(initiativeId),
      ]);
      setStatusData(response);
      setCategoryConfigs(configs);
    } catch {
      setError('Unable to load status overview right now.');
    } finally {
      setIsLoading(false);
    }
  }, [initiativeId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      const response = await api.refreshProjectStatus(initiativeId, 'manual_refresh');
      setStatusData(response);
      const configs = await api.listStatusCategories(initiativeId);
      setCategoryConfigs(configs);
    } catch {
      setError('Refresh failed. Please try again.');
    } finally {
      setIsRefreshing(false);
    }
  }, [initiativeId]);

  useEffect(() => {
    if (refreshToken <= 0) return;
    void onRefresh();
  }, [onRefresh, refreshToken]);

  const rows = useMemo(() => statusData?.categories ?? [], [statusData]);

  const openCreateEditor = () => {
    setEditingCategory(null);
    setEditorOpen(true);
  };

  const openEditEditor = async (row: ProjectStatusCategoryRow) => {
    const existing = categoryConfigs.find((item) => item.category_key === row.category_key);
    if (existing) {
      setEditingCategory(existing);
      setEditorOpen(true);
      return;
    }
    try {
      const configs = await api.listStatusCategories(initiativeId);
      setCategoryConfigs(configs);
      setEditingCategory(configs.find((item) => item.category_key === row.category_key) ?? null);
      setEditorOpen(true);
    } catch {
      setError('Unable to open category editor.');
    }
  };

  const onDeleteCategory = async (categoryKey: string) => {
    if (readOnly) return;
    setDeletingKey(categoryKey);
    setError(null);
    try {
      await api.deleteStatusCategory(initiativeId, categoryKey);
      await loadStatus();
    } catch {
      setError('Unable to delete category.');
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <>
      <div className="mt-2 rounded-xl border border-black/[0.05] bg-surface-subtle/40">
        {error ? <p className="px-4 pt-3 text-sm text-red-500">{error}</p> : null}

        {isLoading ? (
          <p className="px-4 py-4 text-sm text-text-tertiary">Loading status overview...</p>
        ) : (
          <div className="divide-y divide-divider">
            {rows.map((row) => {
              const meta = STATUS_META[row.effective_status];
              const StatusIcon = meta.Icon;
              const confidenceMeta = CONFIDENCE_META[row.confidence];
              const ConfidenceIcon = confidenceMeta.icon;
              const sourceEntries = (row.retrieved_sources ?? [])
                .filter((src): src is ProjectStatusSourceReference => Boolean(src?.source_title && src?.source_type))
                .slice(0, 3);
              const assessmentEntries = (row.relevant_assessments ?? []).slice(0, 3);
              return (
                <div key={row.category_key} className="px-4 py-3">
                  <div className="flex flex-col gap-2">
                    <div className="min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 pt-1">
                          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-secondary">
                            {row.label}
                          </p>
                          {row.criteria_summary ? (
                            <p className="mt-1 text-xs text-text-tertiary line-clamp-2">{row.criteria_summary}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {!readOnly ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => void openEditEditor(row)}
                                className="rounded-lg p-1.5 text-text-tertiary hover:bg-white hover:text-text-primary"
                                aria-label={`Edit ${row.label}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void onDeleteCategory(row.category_key)}
                                disabled={deletingKey === row.category_key}
                                className="rounded-lg p-1.5 text-text-tertiary hover:bg-white hover:text-red-600"
                                aria-label={`Delete ${row.label}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : null}
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${meta.className}`}>
                            <StatusIcon className="h-3 w-3" />
                            <span className="text-[10px] font-medium uppercase tracking-wider">{meta.label}</span>
                          </span>
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${confidenceMeta.bg}`}>
                            <ConfidenceIcon className={`h-3 w-3 ${confidenceMeta.text}`} />
                            <span className={`text-[10px] font-medium uppercase tracking-wider ${confidenceMeta.text}`}>
                              {row.confidence} confidence
                            </span>
                          </span>
                        </div>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                        {row.critical_insight || row.rationale}
                      </p>
                      {(sourceEntries.length > 0 || assessmentEntries.length > 0) ? (
                        <div className="mt-2 flex justify-end">
                          <StatusSourcesMenu
                            sources={sourceEntries}
                            assessments={assessmentEntries}
                            onOpenDocument={onOpenDocument}
                            onOpenAssessment={onOpenWorkspaceAssessment}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-divider px-4 py-3">
          {!readOnly ? (
            <button type="button" onClick={openCreateEditor} className="btn-compact-neutral">
              <Plus className="h-3.5 w-3.5" />
              Add category
            </button>
          ) : (
            <span />
          )}
          {!hideRefreshButton ? (
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={isRefreshing || readOnly}
              className="btn-compact-neutral"
              title={readOnly ? 'View-only access cannot refresh status overview' : 'Refresh status overview'}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          ) : null}
        </div>
      </div>

      {editorOpen ? (
        <StatusCategoryEditorModal
          initiativeId={initiativeId}
          category={editingCategory}
          onClose={() => setEditorOpen(false)}
          onSaved={() => void loadStatus()}
        />
      ) : null}
    </>
  );
}
