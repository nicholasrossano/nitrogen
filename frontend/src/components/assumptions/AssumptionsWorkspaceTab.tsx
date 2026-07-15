'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, FileText, Globe, MessageSquare, Plus, Sparkles, X } from 'lucide-react';

import { ReadOnlyDataTable, type ReadOnlyDataTableColumn } from '@/components/ui/ReadOnlyDataTable';
import { WorkspaceTabLoader } from '@/components/ui';
import { CitationChip } from '@/components/ui/CitationChip';
import { CustomDropdown } from '@/components/ui/CustomDropdown';
import { PROJECT_VARIABLES } from '@/lib/projectVariablesCopy';
import {
  api,
  type Assumption,
  type AssumptionStatus,
  type ProjectMaterial,
} from '@/lib/api';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import { AssumptionCommentsThread } from './AssumptionCommentsThread';

const ASSUMPTION_UPDATED_EVENT = 'nitrogen:assumption-updated';
const ASSUMPTION_DELETED_EVENT = 'nitrogen:assumption-deleted';

interface AssumptionsWorkspaceTabProps {
  projectId: string;
  embedded?: boolean;
  showDetailPanel?: boolean;
  focusAssumptionId?: string | null;
  onAssumptionSelectInChat?: (assumption: Assumption) => void;
  onAddAssumptionInChat?: () => void;
  onOpenDocument?: (citation: ResearchPanelCitation) => void;
  onOpenFile?: (file: ProjectMaterial) => void;
}

const STATUS_OPTIONS: Array<{ value: '' | AssumptionStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'validated', label: 'Validated' },
  { value: 'extracted', label: 'Extracted' },
  { value: 'assumed', label: 'Assumed' },
  { value: 'missing', label: 'Missing' },
];

function formatNumeric(value: number, valueType?: Assumption['value_type']): string {
  if (!Number.isFinite(value)) return String(value);
  if (valueType === 'currency') {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function isMissingValue(value: any): boolean {
  return value === null || value === undefined || value === '';
}

export function formatValue(value: any, unit?: string | null, valueType?: Assumption['value_type']): string {
  if (isMissingValue(value)) return '';
  const formatted = typeof value === 'number'
    ? formatNumeric(value, valueType)
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

function MissingValuePill() {
  return (
    <span className="inline-flex items-center rounded border border-stroke-subtle bg-surface-subtle px-1.5 py-0.5 text-[10px] font-medium leading-none text-text-secondary">
      null
    </span>
  );
}

function formatSourceType(sourceType: string): string {
  return sourceType.replace(/_/g, ' ');
}

function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function firstReferenceSource(sourceReference: Record<string, any> | null | undefined): Record<string, any> | null {
  const sources = sourceReference?.sources;
  if (!Array.isArray(sources)) return null;
  return sources.find((source) => source && typeof source === 'object') ?? null;
}

function sourceCitationFromAssumption(row: Assumption): {
  title: string;
  url: string | null;
  publisher: string | null;
  evidenceDocId: string | null;
  chunkId: string | null;
  materialId: string | null;
} | null {
  const ref = row.source_reference;
  const nested = firstReferenceSource(ref);
  const evidenceSource = (() => {
    const sources = Array.isArray(ref?.sources) ? ref.sources : [];
    return (
      sources.find((source) => {
        if (!source || typeof source !== 'object') return false;
        const sourceType = String(source.source_type || '').toLowerCase();
        return (
          sourceType === 'evidence'
          || typeof source.evidence_doc_id === 'string'
        );
      }) ?? null
    );
  })();
  const materialSource = (() => {
    const sources = Array.isArray(ref?.sources) ? ref.sources : [];
    return (
      sources.find((source) => {
        if (!source || typeof source !== 'object') return false;
        return String(source.source_type || '').toLowerCase() === 'material' && typeof source.id === 'string';
      }) ?? null
    );
  })();
  const title = (
    ref?.source_title ??
    ref?.title ??
    nested?.source_title ??
    nested?.title ??
    nested?.filename ??
    evidenceSource?.title ??
    evidenceSource?.source_title ??
    materialSource?.title ??
    null
  );
  const url = (
    ref?.source_url ??
    ref?.url ??
    nested?.source_url ??
    nested?.url ??
    null
  );
  const publisher = (
    ref?.publisher ??
    nested?.publisher ??
    (typeof url === 'string' ? hostnameFromUrl(url) : null)
  );
  const evidenceDocId = (
    (typeof ref?.evidence_doc_id === 'string' && ref.evidence_doc_id)
    || (typeof evidenceSource?.evidence_doc_id === 'string' && evidenceSource.evidence_doc_id)
    || (typeof evidenceSource?.id === 'string' && evidenceSource.id)
    || (typeof nested?.evidence_doc_id === 'string' && nested.evidence_doc_id)
    || (
      String(nested?.source_type || '').toLowerCase() === 'evidence'
      && typeof nested?.id === 'string'
      && nested.id
    )
    || null
  );
  const chunkId = (
    (typeof ref?.chunk_id === 'string' && ref.chunk_id)
    || (typeof evidenceSource?.chunk_id === 'string' && evidenceSource.chunk_id)
    || (typeof nested?.chunk_id === 'string' && nested.chunk_id)
    || null
  );
  const materialId = (
    (typeof ref?.project_material_id === 'string' && ref.project_material_id)
    || (typeof materialSource?.id === 'string' && materialSource.id)
    || (
      String(nested?.source_type || '').toLowerCase() === 'material'
      && typeof nested?.id === 'string'
      && nested.id
    )
    || null
  );
  const resolvedTitle = typeof title === 'string' && title.trim()
    ? title
    : evidenceDocId || materialId
      ? 'Document'
      : null;
  if (!resolvedTitle) return null;
  return {
    title: resolvedTitle,
    url: typeof url === 'string' && url.length > 0 ? url : null,
    publisher: typeof publisher === 'string' && publisher.length > 0 ? publisher : null,
    evidenceDocId,
    chunkId,
    materialId,
  };
}

function SourceCell({
  row,
  onOpenDocument,
  onOpenFile,
}: {
  row: Assumption;
  onOpenDocument?: (citation: ResearchPanelCitation) => void;
  onOpenFile?: (file: ProjectMaterial) => void;
}) {
  const citation = sourceCitationFromAssumption(row);
  if (!citation) {
    return <span className="text-text-secondary">{formatSourceType(row.source_type)}</span>;
  }

  const label = citation.publisher || citation.title;
  const canOpenEvidence = Boolean(citation.evidenceDocId && onOpenDocument);
  const canOpenMaterial = Boolean(!canOpenEvidence && citation.materialId && onOpenFile);
  const openInternal = canOpenEvidence
    ? () => {
        onOpenDocument?.({
          evidence_doc_id: citation.evidenceDocId!,
          chunk_id: citation.chunkId,
          source_title: citation.title,
        });
      }
    : canOpenMaterial
      ? () => {
          onOpenFile?.({
            id: citation.materialId!,
            filename: citation.title,
            file_type: 'text',
            file_size: null,
            created_at: '',
            source: 'material',
          });
        }
      : null;

  return (
    <CitationChip
      title={citation.title}
      size="compact"
      href={openInternal ? null : citation.url}
      onActivate={openInternal}
      onLinkClick={(event) => event.stopPropagation()}
      icon={row.source_type === 'model_candidate'
        ? <Globe className="h-2.5 w-2.5 shrink-0" />
        : <FileText className="h-2.5 w-2.5 shrink-0" />}
      label={
        <>
          <span className="max-w-[220px] truncate">{label}</span>
          {!openInternal && citation.url ? <ExternalLink className="h-2.5 w-2.5 shrink-0" /> : null}
        </>
      }
    />
  );
}

export function normalizeDraftValue(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === '' ||
    normalized === '—' ||
    normalized === '-' ||
    normalized === '–' ||
    normalized === 'n/a' ||
    normalized === 'na' ||
    normalized === 'none' ||
    normalized === 'null' ||
    normalized === 'missing' ||
    normalized === 'unknown' ||
    normalized.startsWith('unknown ')
  ) {
    return null;
  }
  return raw.trim();
}

const STATUS_STYLES: Record<AssumptionStatus, { bg: string; text: string; label: string }> = {
  validated: { bg: 'bg-green-50', text: 'text-green-700', label: 'Validated' },
  extracted: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Extracted' },
  assumed: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Assumed' },
  missing: { bg: 'bg-red-50', text: 'text-red-700', label: 'Missing' },
};

export function AssumptionsWorkspaceTab({
  projectId,
  embedded = false,
  showDetailPanel = true,
  focusAssumptionId = null,
  onAssumptionSelectInChat,
  onAddAssumptionInChat,
  onOpenDocument,
  onOpenFile,
}: AssumptionsWorkspaceTabProps) {
  const [rows, setRows] = useState<Assumption[]>([]);
  const [selected, setSelected] = useState<Assumption | null>(null);
  const [status, setStatus] = useState<'' | AssumptionStatus>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [draftUnit, setDraftUnit] = useState('');

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.listAssumptions(projectId, {
        status,
      });
      setRows(next);
      setSelected((current) => next.find((row) => row.id === current?.id) ?? null);
    } catch (e: any) {
      setError(e.message ?? `Failed to load ${PROJECT_VARIABLES.lower}`);
    } finally {
      setLoading(false);
    }
  }, [projectId, status]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    setDraftValue(selected ? formatValue(selected.value, null, selected.value_type) : '');
    setDraftUnit(selected?.unit ?? '');
  }, [selected]);

  useEffect(() => {
    if (!focusAssumptionId) return;
    const match = rows.find((row) => row.id === focusAssumptionId);
    if (!match) return;
    if (onAssumptionSelectInChat) {
      onAssumptionSelectInChat(match);
      return;
    }
    setSelected((current) => (current?.id === match.id ? current : match));
  }, [focusAssumptionId, rows, onAssumptionSelectInChat]);

  const matchesActiveFilters = useCallback((row: Assumption) => {
    if (status && row.status !== status) return false;
    return true;
  }, [status]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleAssumptionUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<Assumption>;
      const updated = customEvent.detail;
      if (!updated || updated.project_id !== projectId) return;

      const includeInTable = matchesActiveFilters(updated);
      setRows((prev) => {
        const existingIndex = prev.findIndex((row) => row.id === updated.id);
        if (!includeInTable) {
          if (existingIndex === -1) return prev;
          return prev.filter((row) => row.id !== updated.id);
        }
        if (existingIndex === -1) return [updated, ...prev];
        return prev.map((row) => (row.id === updated.id ? updated : row));
      });
      setSelected((current) => {
        if (current?.id !== updated.id) return current;
        return includeInTable ? updated : null;
      });
    };
    const handleAssumptionDeleted = (event: Event) => {
      const customEvent = event as CustomEvent<{ assumptionId?: string; projectId?: string }>;
      const assumptionId = customEvent.detail?.assumptionId;
      const deletedInitiativeId = customEvent.detail?.projectId;
      if (!assumptionId || deletedInitiativeId !== projectId) return;
      setRows((prev) => prev.filter((row) => row.id !== assumptionId));
      setSelected((current) => (current?.id === assumptionId ? null : current));
    };

    window.addEventListener(ASSUMPTION_UPDATED_EVENT, handleAssumptionUpdated as EventListener);
    window.addEventListener(ASSUMPTION_DELETED_EVENT, handleAssumptionDeleted as EventListener);
    return () => {
      window.removeEventListener(ASSUMPTION_UPDATED_EVENT, handleAssumptionUpdated as EventListener);
      window.removeEventListener(ASSUMPTION_DELETED_EVENT, handleAssumptionDeleted as EventListener);
    };
  }, [projectId, matchesActiveFilters]);

  const selectedValueText = selected ? formatValue(selected.value, null, selected.value_type) : '';
  const hasDraftChanges = Boolean(
    selected && (
      draftValue !== selectedValueText ||
      draftUnit !== (selected.unit ?? '')
    ),
  );
  const hasDraftValue = draftValue.trim() !== '';
  const canConfirm = Boolean(
    selected &&
    hasDraftValue &&
    (selected.status !== 'validated' || hasDraftChanges) &&
    !saving,
  );
  const handleAssumptionOpen = useCallback((row: Assumption) => {
    if (onAssumptionSelectInChat) {
      onAssumptionSelectInChat(row);
      return;
    }
    setSelected(row);
  }, [onAssumptionSelectInChat]);

  const columns: ReadOnlyDataTableColumn<Assumption>[] = [
    {
      key: 'label',
      header: PROJECT_VARIABLES.titleSingular,
      className: 'min-w-[190px] text-text-primary',
      render: (row) => (
        <button
          type="button"
          className="text-left font-medium text-text-primary enabled:hover:text-accent"
          onClick={(event) => {
            event.stopPropagation();
            handleAssumptionOpen(row);
          }}
        >
          <span className="block">{row.label}</span>
          {Array.isArray(row.aliases) && row.aliases.some((a) => a && a !== row.label) ? (
            <span className="mt-0.5 block text-[11px] font-normal text-text-secondary">
              also: {row.aliases.filter((a) => a && a !== row.label).slice(0, 3).join(', ')}
            </span>
          ) : null}
        </button>
      ),
    },
    {
      key: 'value',
      header: 'Value',
      className: 'min-w-[160px]',
      render: (row) => (isMissingValue(row.value) ? <MissingValuePill /> : formatValue(row.value, row.unit, row.value_type)),
    },
    {
      key: 'status',
      header: 'Status',
      className: 'whitespace-nowrap min-w-[120px]',
      render: (row) => (
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
            STATUS_STYLES[row.status].bg
          } ${STATUS_STYLES[row.status].text}`}
        >
          {row.status === 'validated' && <CheckCircle2 className="w-2.5 h-2.5" />}
          {row.status === 'extracted' && <MessageSquare className="w-2.5 h-2.5" />}
          {row.status === 'assumed' && <Sparkles className="w-2.5 h-2.5" />}
          {row.status === 'missing' && <AlertCircle className="w-2.5 h-2.5" />}
          {STATUS_STYLES[row.status].label}
        </span>
      ),
    },
    { key: 'source_type', header: 'Source', className: 'min-w-[180px] max-w-[240px]', render: (row) => (
      <SourceCell row={row} onOpenDocument={onOpenDocument} onOpenFile={onOpenFile} />
    ) },
    { key: 'last_updated_by_email', header: 'Updated By', className: 'whitespace-nowrap min-w-[150px]', render: (row) => row.last_updated_by_email || row.created_by_email || 'system' },
  ];

  const updateSelected = useCallback(async (updates: Partial<Assumption>) => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateAssumption(selected.id, updates);
      setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setSelected(updated);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(ASSUMPTION_UPDATED_EVENT, { detail: updated }),
        );
      }
    } catch (e: any) {
      setError(e.message ?? `Failed to update ${PROJECT_VARIABLES.lowerSingular}`);
    } finally {
      setSaving(false);
    }
  }, [selected]);

  const handleConfirm = useCallback(async () => {
    if (!selected) return;
    const normalizedDraft = normalizeDraftValue(draftValue);
    let parsedValue: any = normalizedDraft;
    if (selected.value_type === 'number' || selected.value_type === 'percent' || selected.value_type === 'currency') {
      const asNumber = Number((normalizedDraft ?? '').replace(/,/g, ''));
      parsedValue = Number.isFinite(asNumber) ? asNumber : null;
    }
    await updateSelected({
      value: parsedValue,
      unit: draftUnit || null,
      status: parsedValue === null ? 'missing' : 'validated',
    });
  }, [draftUnit, draftValue, selected, updateSelected]);

  const handleCancel = useCallback(() => {
    if (!selected) return;
    setDraftValue(formatValue(selected.value, null, selected.value_type));
    setDraftUnit(selected.unit ?? '');
  }, [selected]);

  if (loading) return <WorkspaceTabLoader />;

  const detailOpen = Boolean(showDetailPanel && selected);
  const detailPanelClass = embedded
    ? 'flex min-h-0 h-full flex-col overflow-y-auto border-l border-divider bg-white p-4'
    : 'rounded-xl border border-divider bg-white p-4';

  return (
    <div className={embedded ? 'flex h-full min-h-0 flex-col overflow-hidden' : 'h-full overflow-y-auto p-6'}>
      <div
        className={
          embedded
            ? detailOpen
              ? 'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] gap-0'
              : 'flex min-h-0 flex-1 flex-col'
            : `mx-auto grid max-w-7xl gap-6 ${detailOpen ? 'lg:grid-cols-[minmax(0,1fr)_360px]' : ''}`
        }
      >
        <div className={embedded ? 'flex min-h-0 flex-col overflow-hidden px-4 pb-4 pt-4' : 'space-y-6'}>
          {!embedded ? (
            <div>
              <h1 className="text-lg font-semibold text-text-primary">{PROJECT_VARIABLES.title}</h1>
              <p className="mt-1 text-sm text-text-tertiary">
                Project-wide values and claims used by assessments, forecasts, and outputs.
                {showDetailPanel && !selected
                  ? ` Select a ${PROJECT_VARIABLES.lowerSingular} to open it to explore it further.`
                  : ''}
              </p>
            </div>
          ) : null}

          {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div> : null}

          <div className={`flex flex-wrap items-center justify-between gap-2 ${embedded ? 'pb-4' : ''}`}>
            <div className="flex flex-wrap items-center gap-2">
              <CustomDropdown
                value={status}
                onChange={(value) => setStatus(value as '' | AssumptionStatus)}
                options={STATUS_OPTIONS}
                ariaLabel={`Filter ${PROJECT_VARIABLES.lower} by status`}
              />
            </div>
            {onAddAssumptionInChat ? (
              <button
                type="button"
                className="btn-primary !h-7 !text-xs !leading-none !px-2.5 !py-0 !rounded-lg shrink-0"
                onClick={onAddAssumptionInChat}
              >
                <Plus className="w-3 h-3" />
                Add {PROJECT_VARIABLES.lowerSingular}
              </button>
            ) : null}
          </div>

          {embedded ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ReadOnlyDataTable
                columns={columns}
                rows={rows}
                pageSize={25}
                onRowClick={handleAssumptionOpen}
                emptyState={
                  <div className="py-20 text-center">
                    <p className="text-sm font-medium text-text-secondary">No {PROJECT_VARIABLES.lower} yet</p>
                    <p className="mt-1 text-xs text-text-tertiary">
                      Upload project materials or create assessments to start tracking {PROJECT_VARIABLES.lower}.
                    </p>
                  </div>
                }
              />
            </div>
          ) : (
            <ReadOnlyDataTable
              columns={columns}
              rows={rows}
              pageSize={25}
              onRowClick={handleAssumptionOpen}
              emptyState={
                <div className="py-20 text-center">
                  <p className="text-sm font-medium text-text-secondary">No {PROJECT_VARIABLES.lower} yet</p>
                  <p className="mt-1 text-xs text-text-tertiary">
                    Upload project materials or create assessments to start tracking {PROJECT_VARIABLES.lower}.
                  </p>
                </div>
              }
            />
          )}
        </div>

        {detailOpen && selected ? (
          <aside className={detailPanelClass}>
            <div className="space-y-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary">Selected {PROJECT_VARIABLES.lowerSingular}</p>
                  <h2 className="mt-1 text-base font-semibold text-text-primary">{selected.label}</h2>
                  <p className="mt-1 text-xs text-text-tertiary">{selected.key}</p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-md p-1 text-text-tertiary transition-colors hover:bg-surface-subtle hover:text-text-primary"
                  aria-label={`Close ${PROJECT_VARIABLES.lowerSingular} details`}
                  onClick={() => setSelected(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <label className="block">
                <span className="text-xs font-medium text-text-tertiary">Value</span>
                <input className="mt-1 w-full rounded-lg border border-stroke-subtle px-3 py-2 text-sm" value={draftValue} onChange={(event) => setDraftValue(event.target.value)} />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-text-tertiary">Unit</span>
                <input className="mt-1 w-full rounded-lg border border-stroke-subtle px-3 py-2 text-sm" value={draftUnit} onChange={(event) => setDraftUnit(event.target.value)} />
              </label>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="btn-secondary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 inline-flex items-center shrink-0"
                  onClick={handleCancel}
                  disabled={saving || !hasDraftChanges}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 inline-flex items-center shrink-0"
                  onClick={handleConfirm}
                  disabled={!canConfirm}
                >
                  Confirm
                </button>
              </div>

              <AssumptionCommentsThread assumptionId={selected.id} />
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
