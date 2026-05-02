'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, FileText, Globe, MessageSquare, Sparkles } from 'lucide-react';

import { AssessmentInstanceOpenDropdown } from '@/components/framework/AssessmentInstanceOpenDropdown';
import { ReadOnlyDataTable, type ReadOnlyDataTableColumn } from '@/components/ui/ReadOnlyDataTable';
import { WorkspaceTabLoader } from '@/components/ui';
import { CustomDropdown } from '@/components/ui/CustomDropdown';
import {
  api,
  type Assumption,
  type AssessmentInstance,
  type AssumptionSourceType,
  type AssumptionStatus,
} from '@/lib/api';
import { AssumptionCommentsThread } from './AssumptionCommentsThread';

const ASSUMPTION_UPDATED_EVENT = 'nitrogen:assumption-updated';

interface AssumptionsWorkspaceTabProps {
  initiativeId: string;
  embedded?: boolean;
  showDetailPanel?: boolean;
  focusAssumptionId?: string | null;
  onAssumptionSelectInChat?: (assumption: Assumption) => void;
  assessmentInstances?: AssessmentInstance[];
  onOpenAssessmentInstance?: (instance: AssessmentInstance) => Promise<void> | void;
}

const STATUS_OPTIONS: Array<{ value: '' | AssumptionStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'validated', label: 'Validated' },
  { value: 'extracted', label: 'Extracted' },
  { value: 'assumed', label: 'Assumed' },
  { value: 'missing', label: 'Missing' },
];

const SOURCE_OPTIONS: Array<{ value: '' | AssumptionSourceType; label: string }> = [
  { value: '', label: 'All sources' },
  { value: 'extraction', label: 'Extraction' },
  { value: 'user_input', label: 'User input' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'default', label: 'Default' },
  { value: 'missing_placeholder', label: 'Missing placeholder' },
  { value: 'model_candidate', label: 'Model candidate' },
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

function formatValue(value: any, unit?: string | null, valueType?: Assumption['value_type']): string {
  if (value === null || value === undefined || value === '') return '—';
  const formatted = typeof value === 'number'
    ? formatNumeric(value, valueType)
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
  return unit ? `${formatted} ${unit}` : formatted;
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
} | null {
  const ref = row.source_reference;
  const nested = firstReferenceSource(ref);
  const title = (
    ref?.source_title ??
    ref?.title ??
    nested?.source_title ??
    nested?.title ??
    nested?.filename ??
    null
  );
  if (!title || typeof title !== 'string') return null;
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
  return {
    title,
    url: typeof url === 'string' && url.length > 0 ? url : null,
    publisher: typeof publisher === 'string' && publisher.length > 0 ? publisher : null,
  };
}

function SourceCell({ row }: { row: Assumption }) {
  const citation = sourceCitationFromAssumption(row);
  if (!citation) {
    return <span className="text-text-secondary">{formatSourceType(row.source_type)}</span>;
  }

  const label = citation.publisher || citation.title;
  const chip = (
    <span
      title={citation.title}
      className="inline-flex max-w-[220px] items-center gap-1 rounded border border-stroke-subtle bg-surface-subtle px-1.5 py-0.5 text-[10px] font-medium leading-none text-text-secondary transition-colors hover:border-accent/30 hover:bg-accent/[0.07] hover:text-accent"
    >
      {row.source_type === 'model_candidate' ? (
        <Globe className="h-3 w-3 shrink-0" />
      ) : (
        <FileText className="h-3 w-3 shrink-0" />
      )}
      <span className="truncate">{label}</span>
      {citation.url ? <ExternalLink className="h-2.5 w-2.5 shrink-0" /> : null}
    </span>
  );

  if (!citation.url) return chip;

  return (
    <a
      href={citation.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex no-underline"
      onClick={(event) => event.stopPropagation()}
    >
      {chip}
    </a>
  );
}

function normalizeDraftValue(raw: string): string | null {
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
  initiativeId,
  embedded = false,
  showDetailPanel = true,
  focusAssumptionId = null,
  onAssumptionSelectInChat,
  assessmentInstances = [],
  onOpenAssessmentInstance,
}: AssumptionsWorkspaceTabProps) {
  const [rows, setRows] = useState<Assumption[]>([]);
  const [selected, setSelected] = useState<Assumption | null>(null);
  const [status, setStatus] = useState<'' | AssumptionStatus>('');
  const [sourceType, setSourceType] = useState<'' | AssumptionSourceType>('');
  const [assessmentFilter, setAssessmentFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [draftUnit, setDraftUnit] = useState('');

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.listAssumptions(initiativeId, {
        status,
        source_type: sourceType,
        assessment: assessmentFilter.trim(),
      });
      setRows(next);
      setSelected((current) => next.find((row) => row.id === current?.id) ?? null);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load assumptions');
    } finally {
      setLoading(false);
    }
  }, [initiativeId, assessmentFilter, sourceType, status]);

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
    setSelected((current) => (current?.id === match.id ? current : match));
  }, [focusAssumptionId, rows]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleAssumptionUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<Assumption>;
      const updated = customEvent.detail;
      if (!updated || updated.initiative_id !== initiativeId) return;

      setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setSelected((current) => (current?.id === updated.id ? updated : current));
    };

    window.addEventListener(ASSUMPTION_UPDATED_EVENT, handleAssumptionUpdated as EventListener);
    return () => {
      window.removeEventListener(ASSUMPTION_UPDATED_EVENT, handleAssumptionUpdated as EventListener);
    };
  }, [initiativeId]);

  const assessmentOptions = useMemo(() => {
    const assessments = new Set<string>();
    rows.forEach((row) => row.used_in_assessments.forEach((assessment) => assessments.add(assessment)));
    return Array.from(assessments).sort();
  }, [rows]);
  const assessmentFilterOptions = useMemo(
    () => [
      { value: '', label: 'All assessments' },
      ...assessmentOptions.map((assessment) => ({ value: assessment, label: assessment.replace(/_/g, ' ') })),
    ],
    [assessmentOptions],
  );
  const selectedValueText = selected ? formatValue(selected.value, null, selected.value_type) : '';
  const hasDraftChanges = Boolean(
    selected && (
      draftValue !== selectedValueText ||
      draftUnit !== (selected.unit ?? '')
    ),
  );
  const hasDraftValue = draftValue.trim() !== '' && draftValue.trim() !== '—';
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
      header: 'Assumption',
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
          {row.label}
        </button>
      ),
    },
    { key: 'value', header: 'Value', className: 'min-w-[160px]', render: (row) => formatValue(row.value, row.unit, row.value_type) },
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
    { key: 'source_type', header: 'Source', className: 'min-w-[180px] max-w-[240px]', render: (row) => <SourceCell row={row} /> },
    { key: 'last_updated_by_email', header: 'Updated By', className: 'whitespace-nowrap min-w-[150px]', render: (row) => row.last_updated_by_email || row.created_by_email || 'system' },
    {
      key: 'used_in_assessments',
      header: 'Assessments',
      className: 'min-w-[180px]',
      render: (row) => {
        const relevantInstances = assessmentInstances.filter((instance) => row.used_in_assessments.includes(instance.assessment_id));
        if (relevantInstances.length === 0) return '—';
        if (!onOpenAssessmentInstance) return `${relevantInstances.length} linked`;
        return (
          <AssessmentInstanceOpenDropdown
            instances={relevantInstances}
            onOpenInstance={onOpenAssessmentInstance}
            getInstanceLabel={(instance) => instance.display_name || instance.title || instance.assessment_id.replace(/_/g, ' ')}
          />
        );
      },
    },
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
      setError(e.message ?? 'Failed to update assumption');
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

  return (
    <div className={`h-full overflow-y-auto ${embedded ? 'p-0' : 'p-6'}`}>
      <div className={`mx-auto grid max-w-7xl gap-6 ${showDetailPanel ? 'lg:grid-cols-[minmax(0,1fr)_360px]' : ''}`}>
        <div className="space-y-6">
          {!embedded ? (
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-lg font-semibold text-text-primary">Assumptions</h1>
                <p className="mt-1 text-sm text-text-tertiary">
                  Project-wide values and claims used by assessments, forecasts, and outputs.
                  {!showDetailPanel ? ' Select an assumption to open it in chat.' : ''}
                </p>
              </div>
            </div>
          ) : null}

          {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div> : null}

          <div className="flex flex-wrap gap-2">
            <CustomDropdown
              value={status}
              onChange={(value) => setStatus(value as '' | AssumptionStatus)}
              options={STATUS_OPTIONS}
              ariaLabel="Filter assumptions by status"
            />
            <CustomDropdown
              value={sourceType}
              onChange={(value) => setSourceType(value as '' | AssumptionSourceType)}
              options={SOURCE_OPTIONS}
              ariaLabel="Filter assumptions by source type"
            />
            <CustomDropdown
              value={assessmentFilter}
              onChange={setAssessmentFilter}
              options={assessmentFilterOptions}
              ariaLabel="Filter assumptions by assessment"
            />
          </div>

          <ReadOnlyDataTable
            columns={columns}
            rows={rows}
            pageSize={25}
            onRowClick={handleAssumptionOpen}
            emptyState={
              <div className="py-20 text-center">
                <p className="text-sm font-medium text-text-secondary">No assumptions yet</p>
                <p className="mt-1 text-xs text-text-tertiary">
                  Upload project materials or create assessments to start tracking assumptions.
                </p>
              </div>
            }
          />
        </div>

        {showDetailPanel ? <aside className="rounded-xl border border-divider bg-white p-4">
          {selected ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary">Selected assumption</p>
                <h2 className="mt-1 text-base font-semibold text-text-primary">{selected.label}</h2>
                <p className="mt-1 text-xs text-text-tertiary">{selected.key}</p>
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
          ) : (
            <div className="flex h-full min-h-[260px] items-center justify-center text-center">
              <div>
                <p className="text-sm font-medium text-text-secondary">Select an assumption</p>
                <p className="mt-1 text-xs text-text-tertiary">Open a row to inspect provenance, edit values, or change status.</p>
              </div>
            </div>
          )}
        </aside> : null}
      </div>
    </div>
  );
}
