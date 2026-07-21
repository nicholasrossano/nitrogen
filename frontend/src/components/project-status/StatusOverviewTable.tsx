'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookMarked,
  CheckCircle2,
  Database,
  FileText,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-react';
import {
  api,
  type ProjectStatusAssessmentReference,
  type ProjectStatusCategoryConfig,
  type ProjectStatusCategoryRow,
  type ProjectStatusDecisionSignal,
  type ProjectStatusLevel,
  type ProjectStatusResponse,
  type ProjectStatusSourceReference,
} from '@/lib/api';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import { StatusCategoryEditorModal } from '@/components/project-status/StatusCategoryEditorModal';
import { ModalShell } from '@/components/ui/ModalShell';
import { StatusCapsule } from '@/components/ui/StatusCapsule';
import { Tooltip } from '@/components/ui/Tooltip';
import { getCached, invalidate, setCached, swrFetch, swrKeys } from '@/lib/swrCache';

const STATUS_META: Record<ProjectStatusLevel, { label: string; className: string }> = {
  green: {
    label: 'Green',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  yellow: {
    label: 'Yellow',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  red: {
    label: 'Red',
    className: 'bg-red-50 text-red-700 border-red-200',
  },
  unknown: {
    label: 'Unknown',
    className: 'bg-surface-subtle text-text-secondary border-stroke-subtle',
  },
};

const CONFIDENCE_META = {
  high: { label: 'High confidence', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  medium: { label: 'Medium confidence', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  low: { label: 'Low confidence', className: 'bg-red-50 text-red-700 border-red-200' },
  unknown: { label: 'Unknown confidence', className: 'bg-surface-subtle text-text-secondary border-stroke-subtle' },
} as const;

const SIGNAL_META = {
  positive: { Icon: CheckCircle2, className: 'text-emerald-600' },
  negative: { Icon: XCircle, className: 'text-red-600' },
  neutral: { Icon: AlertCircle, className: 'text-amber-600' },
} as const;

function DecisionSignalList({
  signals,
  fallbackText,
}: {
  signals: ProjectStatusDecisionSignal[] | undefined;
  fallbackText: string;
}) {
  const items = signals?.length ? signals : [{ text: fallbackText, sentiment: 'neutral' as const }];
  return (
    <ul className="mt-1.5 space-y-1">
      {items.map((signal, index) => {
        const { Icon, className } = SIGNAL_META[signal.sentiment];
        return (
          <li key={index} className="flex items-center gap-2 text-sm leading-relaxed text-text-secondary">
            <Icon className={`h-3.5 w-3.5 shrink-0 ${className}`} />
            <span>{signal.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

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
  /** Bumps to reload status after backend signal-driven recomputes. */
  refreshToken?: number;
  /** When true, refreshToken triggers a full POST recompute instead of GET polling. */
  recomputeOnToken?: boolean;
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
  recomputeOnToken = false,
  onOpenDocument,
  onOpenWorkspaceAssessment,
}: StatusOverviewTableProps) {
  const cachedStatus = getCached<{
    response: ProjectStatusResponse;
    configs: ProjectStatusCategoryConfig[];
  }>(swrKeys.status(initiativeId));
  const [statusData, setStatusData] = useState<ProjectStatusResponse | null>(
    cachedStatus?.response ?? null,
  );
  const [categoryConfigs, setCategoryConfigs] = useState<ProjectStatusCategoryConfig[]>(
    cachedStatus?.configs ?? [],
  );
  const [isLoading, setIsLoading] = useState(!cachedStatus);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ProjectStatusCategoryConfig | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectStatusCategoryRow | null>(null);

  const loadStatus = useCallback(async (options?: { force?: boolean; silent?: boolean }) => {
    setError(null);
    const key = swrKeys.status(initiativeId);
    const cached = getCached<{
      response: ProjectStatusResponse;
      configs: ProjectStatusCategoryConfig[];
    }>(key);
    if (cached && !options?.force) {
      setStatusData(cached.response);
      setCategoryConfigs(cached.configs);
      setIsLoading(false);
    } else if (!cached && !options?.silent) {
      // Only blank the table on a true cold load — not after mutations/polls.
      setIsLoading(true);
    }
    try {
      // Status owns first-time category seeding; fetch it before configs so a
      // brand-new project does not race two seeders in parallel.
      const { data } = await swrFetch(
        key,
        async () => {
          const response = await api.getProjectStatus(initiativeId);
          let configs: ProjectStatusCategoryConfig[] = [];
          try {
            configs = await api.listStatusCategories(initiativeId);
          } catch {
            // Editor configs are best-effort; status rows still render.
          }
          return { response, configs };
        },
        { force: options?.force === true },
      );
      setStatusData(data.response);
      setCategoryConfigs(data.configs);
      return data.response;
    } catch {
      if (!cached) setError('Unable to load status overview right now.');
      return null;
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
      const configs = await api.listStatusCategories(initiativeId);
      setCached(swrKeys.status(initiativeId), { response, configs });
      setStatusData(response);
      setCategoryConfigs(configs);
    } catch {
      setError('Refresh failed. Please try again.');
    } finally {
      setIsRefreshing(false);
    }
  }, [initiativeId]);

  // Explicit overview refresh: full recompute. Signal bumps: poll GET for
  // backend-scheduled results (files indexed, assessments approved, etc.).
  useEffect(() => {
    if (refreshToken <= 0) return;
    if (recomputeOnToken) {
      void onRefresh();
      return;
    }

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const delaysMs = [0, 2500, 5500, 10000, 16000];

    const stopPolling = () => {
      cancelled = true;
      timers.forEach((timer) => clearTimeout(timer));
    };

    for (const ms of delaysMs) {
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          void loadStatus({ force: true, silent: true }).then((response) => {
            if (cancelled || !response) return;
            const nextRows = response.categories ?? [];
            const stillPending = nextRows.some(
              (row) => row.update_source === 'not_generated' || row.is_stale,
            );
            if (!stillPending) stopPolling();
          });
        }, ms),
      );
    }

    return () => {
      stopPolling();
    };
  }, [loadStatus, onRefresh, recomputeOnToken, refreshToken]);

  const rows = useMemo(() => statusData?.categories ?? [], [statusData]);
  const awaitingFirstAssessment = useMemo(
    () =>
      rows.length > 0 &&
      rows.every((row) => row.update_source === 'not_generated'),
    [rows],
  );

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

    const previousStatus = statusData;
    const previousConfigs = categoryConfigs;
    const nextStatus = statusData
      ? {
          ...statusData,
          categories: statusData.categories.filter((item) => item.category_key !== categoryKey),
        }
      : null;
    const nextConfigs = categoryConfigs.filter((item) => item.category_key !== categoryKey);

    // Optimistic remove so the row disappears without a loading flash.
    setPendingDelete(null);
    setStatusData(nextStatus);
    setCategoryConfigs(nextConfigs);
    if (nextStatus) {
      setCached(swrKeys.status(initiativeId), { response: nextStatus, configs: nextConfigs });
    } else {
      invalidate(swrKeys.status(initiativeId));
    }

    try {
      await api.deleteStatusCategory(initiativeId, categoryKey);
      await loadStatus({ force: true, silent: true });
    } catch (err) {
      setStatusData(previousStatus);
      setCategoryConfigs(previousConfigs);
      if (previousStatus) {
        setCached(swrKeys.status(initiativeId), {
          response: previousStatus,
          configs: previousConfigs,
        });
      }
      setError(err instanceof Error && err.message ? err.message : 'Unable to delete category.');
    } finally {
      setDeletingKey(null);
    }
  };

  const showAddCategory = !readOnly;
  const showRefresh = !hideRefreshButton || awaitingFirstAssessment;
  const showActions = showAddCategory || showRefresh;

  return (
    <>
      <div className="mt-2">
        <div className="rounded-xl border border-divider bg-white">
          {error ? <p className="px-4 pt-3 text-sm text-red-500">{error}</p> : null}

          {isLoading ? (
            <p className="px-4 py-4 text-sm text-text-tertiary">Loading status overview...</p>
          ) : rows.length === 0 && !error ? (
            <div className="px-4 py-4">
              <p className="text-sm font-medium text-text-primary">No status categories yet</p>
              <p className="mt-1 text-sm text-text-tertiary">
                Add a category to start tracking diligence signals for this project.
              </p>
            </div>
          ) : awaitingFirstAssessment ? (
            <div className="px-4 py-4">
              <p className="text-sm font-medium text-text-primary">Status not scored yet</p>
              <p className="mt-1 text-sm text-text-tertiary">
                Starter categories are ready. Upload materials, then refresh to score this
                project from available evidence.
              </p>
              <ul className="mt-3 space-y-1.5">
                {rows.map((row) => (
                  <li
                    key={row.category_key}
                    className="flex items-center justify-between gap-3 text-sm text-text-secondary"
                  >
                    <span>{row.label}</span>
                    <StatusCapsule size="md" className={STATUS_META.unknown.className}>
                      Not scored
                    </StatusCapsule>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="divide-y divide-divider">
              {rows.map((row) => {
                const meta = STATUS_META[row.effective_status];
                const confidenceMeta = CONFIDENCE_META[row.confidence];
                const sourceEntries = (row.retrieved_sources ?? [])
                  .filter((src): src is ProjectStatusSourceReference => Boolean(src?.source_title && src?.source_type))
                  .slice(0, 3);
                const assessmentEntries = (row.relevant_assessments ?? []).slice(0, 3);
                const infoSummary = (row.criteria_summary || '').trim();
                return (
                  <div key={row.category_key} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-1">
                        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-secondary">
                          {row.label}
                        </p>
                        <div className="flex items-center">
                          {infoSummary ? (
                            <Tooltip content={infoSummary} width={280}>
                              <button
                                type="button"
                                className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-subtle hover:text-text-primary"
                                aria-label={`About ${row.label}`}
                              >
                                <Info className="h-3.5 w-3.5" />
                              </button>
                            </Tooltip>
                          ) : null}
                          {!readOnly ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void openEditEditor(row)}
                                className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-subtle hover:text-text-primary"
                                aria-label={`Edit ${row.label}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDelete(row)}
                                disabled={deletingKey === row.category_key}
                                className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-subtle hover:text-red-600"
                                aria-label={`Delete ${row.label}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                        <StatusCapsule size="md" className={meta.className}>{meta.label}</StatusCapsule>
                        <StatusCapsule size="md" className={confidenceMeta.className}>{confidenceMeta.label}</StatusCapsule>
                      </div>
                    </div>
                    <DecisionSignalList
                      signals={row.decision_signals}
                      fallbackText={row.critical_insight || row.rationale}
                    />
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
                );
              })}
            </div>
          )}
        </div>

        {showActions ? (
          <div className="mt-2 flex items-center justify-between gap-3">
            {showAddCategory ? (
              <button type="button" onClick={openCreateEditor} className="btn-compact-neutral">
                <Plus className="h-3.5 w-3.5" />
                Add category
              </button>
            ) : (
              <span />
            )}
            {showRefresh ? (
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
        ) : null}
      </div>

      {editorOpen ? (
        <StatusCategoryEditorModal
          initiativeId={initiativeId}
          category={editingCategory}
          onClose={() => setEditorOpen(false)}
          onSaved={() => void loadStatus({ force: true, silent: true })}
        />
      ) : null}

      {pendingDelete ? (
        <ModalShell onClose={() => setPendingDelete(null)} maxWidth="max-w-sm">
          <div className="px-5 py-4 border-b border-divider">
            <h2 className="text-base font-semibold text-text-primary">Delete category?</h2>
          </div>
          <div className="px-5 py-4 space-y-2">
            <p className="text-sm text-text-secondary">
              Remove <span className="font-medium text-text-primary">{pendingDelete.label}</span> from
              this project&apos;s status overview? This deletes it for everyone with access to the
              project.
            </p>
          </div>
          <div className="flex justify-end gap-2 border-t border-divider px-5 py-4">
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              disabled={deletingKey === pendingDelete.category_key}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onDeleteCategory(pendingDelete.category_key)}
              disabled={deletingKey === pendingDelete.category_key}
              className="btn-danger"
            >
              {deletingKey === pendingDelete.category_key ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : null}
              Delete
            </button>
          </div>
        </ModalShell>
      ) : null}
    </>
  );
}
