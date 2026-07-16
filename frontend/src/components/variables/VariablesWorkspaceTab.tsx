'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, FileText, Globe, Info, Plus, X } from 'lucide-react';

import { ReadOnlyDataTable, type ReadOnlyDataTableColumn } from '@/components/ui/ReadOnlyDataTable';
import { WorkspaceTabLoader } from '@/components/ui';
import { CitationChip } from '@/components/ui/CitationChip';
import { CompanionSidePanel, COMPANION_SIDE_PANEL_WIDTH } from '@/components/ui/CompanionSidePanel';
import { CustomDropdown } from '@/components/ui/CustomDropdown';
import { Tooltip } from '@/components/ui/Tooltip';
import { PROJECT_VARIABLES } from '@/lib/projectVariablesCopy';
import {
  api,
  type Variable,
  type VariableStatus,
  type ProjectMaterial,
} from '@/lib/api';
import { getCached, invalidatePrefix, setCached, swrFetch, swrKeys } from '@/lib/swrCache';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import { VariableCommentsThread } from './VariableCommentsThread';
import {
  VARIABLE_STATUS_DEFINITIONS,
  VariableStatusCapsule,
} from './VariableStatusCapsule';

const VARIABLE_UPDATED_EVENT = 'nitrogen:variable-updated';
const VARIABLE_DELETED_EVENT = 'nitrogen:variable-deleted';

interface VariablesWorkspaceTabProps {
  projectId: string;
  embedded?: boolean;
  showDetailPanel?: boolean;
  focusVariableId?: string | null;
  /** Keep workbench URL (?variable=) in sync with the open detail selection. */
  onSelectedVariableIdChange?: (variableId: string | null) => void;
  onVariableSelectInChat?: (variable: Variable) => void;
  onAddVariableInChat?: () => void;
  onOpenDocument?: (citation: ResearchPanelCitation) => void;
  onOpenFile?: (file: ProjectMaterial) => void;
  /** Notify float host when the selected-variable companion column is open. */
  onCompanionSidePanelOpenChange?: (open: boolean) => void;
}

const STATUS_OPTIONS: Array<{ value: '' | VariableStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'validated', label: 'Validated' },
  { value: 'extracted', label: 'Extracted' },
  { value: 'assumed', label: 'Assumed' },
  { value: 'missing', label: 'Missing' },
];

function formatNumeric(value: number, valueType?: Variable['value_type']): string {
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

export function formatValue(value: any, unit?: string | null, valueType?: Variable['value_type']): string {
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

/** Falls back to the generic source type label when no more specific name is on record. */
function formatSourceLabel(row: Variable): string {
  if (row.source_type === 'assessment' || row.source_type === 'assessment_approval') {
    const assessmentName = row.source_reference?.assessment_name;
    if (typeof assessmentName === 'string' && assessmentName.trim()) return assessmentName.trim();
  }
  return row.source_type.replace(/_/g, ' ');
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

function sourceCitationFromVariable(row: Variable): {
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
  row: Variable;
  onOpenDocument?: (citation: ResearchPanelCitation) => void;
  onOpenFile?: (file: ProjectMaterial) => void;
}) {
  const citation = sourceCitationFromVariable(row);
  if (!citation) {
    return <span className="text-text-secondary">{formatSourceLabel(row)}</span>;
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
          <span className="min-w-0 truncate">{label}</span>
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

const STATUS_LEGEND_CONTENT = (
  <ul className="space-y-1.5">
    {VARIABLE_STATUS_DEFINITIONS.map(({ status, description }) => (
      <li key={status}>
        <VariableStatusCapsule status={status} />
        <span className="ml-1.5">{description}</span>
      </li>
    ))}
  </ul>
);

export function VariablesWorkspaceTab({
  projectId,
  embedded = false,
  showDetailPanel = true,
  focusVariableId = null,
  onSelectedVariableIdChange,
  onVariableSelectInChat,
  onAddVariableInChat,
  onOpenDocument,
  onOpenFile,
  onCompanionSidePanelOpenChange,
}: VariablesWorkspaceTabProps) {
  const [status, setStatus] = useState<'' | VariableStatus>('');
  const [rows, setRows] = useState<Variable[]>(
    () => getCached<Variable[]>(swrKeys.variables(projectId)) ?? [],
  );
  const [selected, setSelected] = useState<Variable | null>(null);
  const [loading, setLoading] = useState(
    () => getCached<Variable[]>(swrKeys.variables(projectId)) === undefined,
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [draftUnit, setDraftUnit] = useState('');

  const loadRows = useCallback(async () => {
    const key = status
      ? `${swrKeys.variables(projectId)}:${status}`
      : swrKeys.variables(projectId);
    const cached = getCached<Variable[]>(key);
    if (cached) {
      setRows(cached);
      setSelected((current) => cached.find((row) => row.id === current?.id) ?? null);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const { data: next } = await swrFetch(key, () =>
        api.listVariables(projectId, { status }),
      );
      // Keep the unfiltered mini-panel cache warm when loading all.
      if (!status) setCached(swrKeys.variables(projectId), next);
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
    if (!focusVariableId) return;

    const match = rows.find((row) => row.id === focusVariableId);
    if (match) {
      if (showDetailPanel) {
        setSelected((current) => (current?.id === match.id ? current : match));
        return;
      }
      onVariableSelectInChat?.(match);
      return;
    }

    // Row list may still be loading, filtered, or paginated — fetch the focused variable directly.
    if (!showDetailPanel) return;
    let cancelled = false;
    void api.getVariable(focusVariableId)
      .then((variable) => {
        if (cancelled || variable.project_id !== projectId) return;
        setSelected((current) => (current?.id === variable.id ? current : variable));
      })
      .catch(() => {
        // Leave selection unchanged; table load / user click can still recover.
      });
    return () => {
      cancelled = true;
    };
  }, [focusVariableId, rows, onVariableSelectInChat, projectId, showDetailPanel]);

  useEffect(() => {
    const open = Boolean(showDetailPanel && selected);
    onCompanionSidePanelOpenChange?.(open);
    return () => onCompanionSidePanelOpenChange?.(false);
  }, [selected, showDetailPanel, onCompanionSidePanelOpenChange]);

  const matchesActiveFilters = useCallback((row: Variable) => {
    if (status && row.status !== status) return false;
    return true;
  }, [status]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleVariableUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<Variable>;
      const updated = customEvent.detail;
      if (!updated || updated.project_id !== projectId) return;

      invalidatePrefix(swrKeys.variables(projectId));

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
    const handleVariableDeleted = (event: Event) => {
      const customEvent = event as CustomEvent<{ variableId?: string; projectId?: string }>;
      const variableId = customEvent.detail?.variableId;
      const deletedInitiativeId = customEvent.detail?.projectId;
      if (!variableId || deletedInitiativeId !== projectId) return;
      setRows((prev) => prev.filter((row) => row.id !== variableId));
      setSelected((current) => (current?.id === variableId ? null : current));
    };

    window.addEventListener(VARIABLE_UPDATED_EVENT, handleVariableUpdated as EventListener);
    window.addEventListener(VARIABLE_DELETED_EVENT, handleVariableDeleted as EventListener);
    return () => {
      window.removeEventListener(VARIABLE_UPDATED_EVENT, handleVariableUpdated as EventListener);
      window.removeEventListener(VARIABLE_DELETED_EVENT, handleVariableDeleted as EventListener);
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
    !saving &&
    !deleting,
  );
  const handleVariableOpen = useCallback((row: Variable) => {
    if (showDetailPanel) {
      setSelected(row);
      onSelectedVariableIdChange?.(row.id);
      return;
    }
    if (onVariableSelectInChat) {
      onVariableSelectInChat(row);
    }
  }, [onSelectedVariableIdChange, onVariableSelectInChat, showDetailPanel]);

  const handleClearSelection = useCallback(() => {
    setSelected(null);
    onSelectedVariableIdChange?.(null);
  }, [onSelectedVariableIdChange]);

  const columns: ReadOnlyDataTableColumn<Variable>[] = [
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
            handleVariableOpen(row);
          }}
        >
          {row.label}
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
      render: (row) => <VariableStatusCapsule status={row.status} />,
    },
    { key: 'source_type', header: 'Source', className: 'min-w-[120px] max-w-[240px] w-[22%] overflow-hidden', render: (row) => (
      <div className="min-w-0 max-w-full overflow-hidden">
        <SourceCell row={row} onOpenDocument={onOpenDocument} onOpenFile={onOpenFile} />
      </div>
    ) },
    { key: 'last_updated_by_email', header: 'Updated By', className: 'whitespace-nowrap min-w-[150px]', render: (row) => row.last_updated_by_email || row.created_by_email || 'system' },
  ];

  const updateSelected = useCallback(async (updates: Partial<Variable>) => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateVariable(selected.id, updates);
      setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setSelected(updated);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(VARIABLE_UPDATED_EVENT, { detail: updated }),
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

  const handleDelete = useCallback(async () => {
    if (!selected || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const deletedId = selected.id;
      await api.deleteVariable(deletedId);
      setRows((prev) => prev.filter((row) => row.id !== deletedId));
      setSelected(null);
      onSelectedVariableIdChange?.(null);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(VARIABLE_DELETED_EVENT, {
            detail: { variableId: deletedId, projectId },
          }),
        );
      }
    } catch (e: any) {
      setError(e?.message ?? `Failed to delete ${PROJECT_VARIABLES.lowerSingular}`);
    } finally {
      setDeleting(false);
    }
  }, [deleting, onSelectedVariableIdChange, projectId, selected]);

  if (loading) return <WorkspaceTabLoader />;

  const detailOpen = Boolean(showDetailPanel && selected);

  const detailFields = selected ? (
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-4 space-y-4">
      <label className="block">
        <span className="text-xs font-medium text-text-tertiary">Value</span>
        <input
          className="mt-1 w-full rounded-lg border border-stroke-subtle px-3 py-2 text-sm"
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          disabled={saving || deleting}
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium text-text-tertiary">Unit</span>
        <input
          className="mt-1 w-full rounded-lg border border-stroke-subtle px-3 py-2 text-sm"
          value={draftUnit}
          onChange={(event) => setDraftUnit(event.target.value)}
          disabled={saving || deleting}
        />
      </label>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="btn-danger !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 inline-flex items-center shrink-0"
          onClick={() => void handleDelete()}
          disabled={deleting}
          title={`Delete this ${PROJECT_VARIABLES.lowerSingular}`}
        >
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 inline-flex items-center shrink-0 disabled:!opacity-100 disabled:!text-text-tertiary"
            onClick={handleCancel}
            disabled={saving || deleting || !hasDraftChanges}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 inline-flex items-center shrink-0"
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            {saving ? 'Saving...' : 'Confirm'}
          </button>
        </div>
      </div>

      <VariableCommentsThread variableId={selected.id} />
    </div>
  ) : null;

  const tableBlock = (
    <>
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div> : null}

      <div className={`flex flex-wrap items-center justify-between gap-2 ${embedded ? 'pb-4' : ''}`}>
        <div className="flex flex-wrap items-center gap-2">
          <CustomDropdown
            value={status}
            onChange={(value) => setStatus(value as '' | VariableStatus)}
            options={STATUS_OPTIONS}
            ariaLabel={`Filter ${PROJECT_VARIABLES.lower} by status`}
          />
          <Tooltip content={STATUS_LEGEND_CONTENT} width={240}>
            <button
              type="button"
              className="flex items-center justify-center w-5 h-5 rounded-full text-text-tertiary hover:text-text-secondary hover:bg-black/[0.04] transition-colors"
              aria-label="What do the statuses mean?"
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
        {onAddVariableInChat ? (
          <button
            type="button"
            className="btn-primary !h-7 !text-xs !leading-none !px-2.5 !py-0 !rounded-lg shrink-0"
            onClick={onAddVariableInChat}
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
            onRowClick={handleVariableOpen}
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
          onRowClick={handleVariableOpen}
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
    </>
  );

  if (embedded) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-4">
          {tableBlock}
        </div>
        {detailOpen && selected ? (
          <div
            className="flex-shrink-0 h-full min-h-0 overflow-hidden"
            style={{ width: COMPANION_SIDE_PANEL_WIDTH }}
          >
            <CompanionSidePanel
              title={selected.label}
              eyebrow={PROJECT_VARIABLES.titleSingular}
              onClose={handleClearSelection}
              ariaLabel={`${PROJECT_VARIABLES.titleSingular} details`}
            >
              {detailFields}
            </CompanionSidePanel>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div
        className={`mx-auto grid max-w-7xl gap-6 ${detailOpen ? 'lg:grid-cols-[minmax(0,1fr)_360px]' : ''}`}
      >
        <div className="space-y-6">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">{PROJECT_VARIABLES.title}</h1>
            <p className="mt-1 text-sm text-text-tertiary">
              Project-wide values and claims used by assessments, forecasts, and outputs.
              {showDetailPanel && !selected
                ? ` Select a ${PROJECT_VARIABLES.lowerSingular} to open it to explore it further.`
                : ''}
            </p>
          </div>
          {tableBlock}
        </div>

        {detailOpen && selected ? (
          <aside className="rounded-xl border border-divider bg-white p-4">
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
                  onClick={handleClearSelection}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {detailFields}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
