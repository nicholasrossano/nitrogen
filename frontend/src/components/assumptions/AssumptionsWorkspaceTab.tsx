'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ModuleInstanceOpenDropdown } from '@/components/framework/ModuleInstanceOpenDropdown';
import { ReadOnlyDataTable, type ReadOnlyDataTableColumn } from '@/components/ui/ReadOnlyDataTable';
import { WorkspaceTabLoader } from '@/components/ui';
import { CustomDropdown } from '@/components/ui/CustomDropdown';
import {
  api,
  type Assumption,
  type ModuleInstance,
  type AssumptionSourceType,
  type AssumptionStatus,
} from '@/lib/api';
import { AssumptionCommentsThread } from './AssumptionCommentsThread';

interface AssumptionsWorkspaceTabProps {
  initiativeId: string;
  embedded?: boolean;
  showDetailPanel?: boolean;
  focusAssumptionId?: string | null;
  onAssumptionSelectInChat?: (assumption: Assumption) => void;
  moduleInstances?: ModuleInstance[];
  onOpenModuleInstance?: (instance: ModuleInstance) => Promise<void> | void;
}

const STATUS_OPTIONS: Array<{ value: '' | AssumptionStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'inferred', label: 'Inferred' },
  { value: 'assumed', label: 'Assumed' },
  { value: 'missing', label: 'Missing' },
];

const SOURCE_OPTIONS: Array<{ value: '' | AssumptionSourceType; label: string }> = [
  { value: '', label: 'All sources' },
  { value: 'extraction', label: 'Extraction' },
  { value: 'user_input', label: 'User input' },
  { value: 'module', label: 'Module' },
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

function formatStatus(status: AssumptionStatus): string {
  return status.replace('_', ' ');
}

function statusClass(status: AssumptionStatus): string {
  if (status === 'confirmed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'inferred') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (status === 'assumed') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (status === 'missing') return 'border-red-200 bg-red-50 text-red-600';
  return 'border-stroke-subtle bg-surface-subtle text-text-tertiary';
}

export function AssumptionsWorkspaceTab({
  initiativeId,
  embedded = false,
  showDetailPanel = true,
  focusAssumptionId = null,
  onAssumptionSelectInChat,
  moduleInstances = [],
  onOpenModuleInstance,
}: AssumptionsWorkspaceTabProps) {
  const [rows, setRows] = useState<Assumption[]>([]);
  const [selected, setSelected] = useState<Assumption | null>(null);
  const [status, setStatus] = useState<'' | AssumptionStatus>('');
  const [sourceType, setSourceType] = useState<'' | AssumptionSourceType>('');
  const [moduleFilter, setModuleFilter] = useState('');
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
        module: moduleFilter.trim(),
      });
      setRows(next);
      setSelected((current) => next.find((row) => row.id === current?.id) ?? null);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load assumptions');
    } finally {
      setLoading(false);
    }
  }, [initiativeId, moduleFilter, sourceType, status]);

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

  const moduleOptions = useMemo(() => {
    const modules = new Set<string>();
    rows.forEach((row) => row.used_in_modules.forEach((module) => modules.add(module)));
    return Array.from(modules).sort();
  }, [rows]);
  const moduleFilterOptions = useMemo(
    () => [
      { value: '', label: 'All modules' },
      ...moduleOptions.map((module) => ({ value: module, label: module.replace(/_/g, ' ') })),
    ],
    [moduleOptions],
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
    (selected.status !== 'confirmed' || hasDraftChanges) &&
    !saving,
  );

  const columns: ReadOnlyDataTableColumn<Assumption>[] = [
    {
      key: 'label',
      header: 'Assumption',
      className: 'min-w-[190px] text-text-primary',
      render: (row) => (
        <button
          type="button"
          className="text-left font-medium text-text-primary enabled:hover:text-accent"
          onClick={() => {
            if (onAssumptionSelectInChat) {
              onAssumptionSelectInChat(row);
              return;
            }
            setSelected(row);
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
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusClass(row.status)}`}>
          {formatStatus(row.status)}
        </span>
      ),
    },
    { key: 'source_type', header: 'Source', className: 'whitespace-nowrap min-w-[140px]', render: (row) => row.source_type.replace('_', ' ') },
    { key: 'last_updated_by_email', header: 'Updated By', className: 'whitespace-nowrap min-w-[150px]', render: (row) => row.last_updated_by_email || row.created_by_email || 'system' },
    {
      key: 'used_in_modules',
      header: 'Modules',
      className: 'min-w-[180px]',
      render: (row) => {
        const relevantInstances = moduleInstances.filter((instance) => row.used_in_modules.includes(instance.module_id));
        if (relevantInstances.length === 0) return '—';
        if (!onOpenModuleInstance) return `${relevantInstances.length} linked`;
        return (
          <ModuleInstanceOpenDropdown
            instances={relevantInstances}
            onOpenInstance={onOpenModuleInstance}
            getInstanceLabel={(instance) => instance.display_name || instance.title || instance.module_id.replace(/_/g, ' ')}
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
    } catch (e: any) {
      setError(e.message ?? 'Failed to update assumption');
    } finally {
      setSaving(false);
    }
  }, [selected]);

  const handleConfirm = useCallback(async () => {
    if (!selected) return;
    let parsedValue: any = draftValue;
    if (selected.value_type === 'number' || selected.value_type === 'percent' || selected.value_type === 'currency') {
      const asNumber = Number(draftValue.replace(/,/g, ''));
      parsedValue = Number.isFinite(asNumber) ? asNumber : draftValue;
    }
    await updateSelected({
      value: parsedValue,
      unit: draftUnit || null,
      status: 'confirmed',
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
                  Project-wide values and claims used by modules, forecasts, and outputs.
                </p>
                {!showDetailPanel ? (
                  <p className="mt-1 text-xs text-text-tertiary">
                    Select an assumption to open it in chat.
                  </p>
                ) : null}
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
              value={moduleFilter}
              onChange={setModuleFilter}
              options={moduleFilterOptions}
              ariaLabel="Filter assumptions by module"
            />
          </div>

          <ReadOnlyDataTable
            columns={columns}
            rows={rows}
            pageSize={25}
            emptyState={
              <div className="py-20 text-center">
                <p className="text-sm font-medium text-text-secondary">No assumptions yet</p>
                <p className="mt-1 text-xs text-text-tertiary">
                  Upload project materials or create modules to start tracking assumptions.
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
