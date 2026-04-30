'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ReadOnlyDataTable, type ReadOnlyDataTableColumn } from '@/components/ui/ReadOnlyDataTable';
import { WorkspaceTabLoader } from '@/components/ui';
import {
  api,
  type Assumption,
  type AssumptionSourceType,
  type AssumptionStatus,
} from '@/lib/api';

interface AssumptionsWorkspaceTabProps {
  initiativeId: string;
}

const STATUS_OPTIONS: Array<{ value: '' | AssumptionStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'missing', label: 'Missing' },
  { value: 'rejected', label: 'Rejected' },
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

function formatValue(value: any, unit?: string | null): string {
  if (value === null || value === undefined || value === '') return '—';
  const formatted = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatStatus(status: AssumptionStatus): string {
  return status.replace('_', ' ');
}

function statusClass(status: AssumptionStatus): string {
  if (status === 'confirmed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'missing') return 'border-red-200 bg-red-50 text-red-600';
  if (status === 'rejected') return 'border-stroke-subtle bg-surface-subtle text-text-tertiary';
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

export function AssumptionsWorkspaceTab({ initiativeId }: AssumptionsWorkspaceTabProps) {
  const [rows, setRows] = useState<Assumption[]>([]);
  const [selected, setSelected] = useState<Assumption | null>(null);
  const [status, setStatus] = useState<'' | AssumptionStatus>('');
  const [sourceType, setSourceType] = useState<'' | AssumptionSourceType>('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [draftUnit, setDraftUnit] = useState('');
  const [draftNotes, setDraftNotes] = useState('');

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
    setDraftValue(selected ? formatValue(selected.value, null) : '');
    setDraftUnit(selected?.unit ?? '');
    setDraftNotes(selected?.notes ?? '');
  }, [selected]);

  const moduleOptions = useMemo(() => {
    const modules = new Set<string>();
    rows.forEach((row) => row.used_in_modules.forEach((module) => modules.add(module)));
    return Array.from(modules).sort();
  }, [rows]);

  const columns: ReadOnlyDataTableColumn<Assumption>[] = [
    {
      key: 'label',
      header: 'Assumption',
      className: 'min-w-[190px] text-text-primary',
      render: (row) => (
        <button
          type="button"
          className="text-left font-medium text-text-primary enabled:hover:text-accent"
          onClick={() => setSelected(row)}
        >
          {row.label}
        </button>
      ),
    },
    { key: 'value', header: 'Value', className: 'min-w-[160px]', render: (row) => formatValue(row.value, row.unit) },
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
    { key: 'used_in_modules', header: 'Modules', className: 'min-w-[180px]', render: (row) => row.used_in_modules.join(', ') || '—' },
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
    } catch (e: any) {
      setError(e.message ?? 'Failed to update assumption');
    } finally {
      setSaving(false);
    }
  }, [selected]);

  const handleSave = useCallback(async () => {
    if (!selected) return;
    let parsedValue: any = draftValue;
    if (selected.value_type === 'number' || selected.value_type === 'percent' || selected.value_type === 'currency') {
      const asNumber = Number(draftValue.replace(/,/g, ''));
      parsedValue = Number.isFinite(asNumber) ? asNumber : draftValue;
    }
    await updateSelected({
      value: parsedValue,
      unit: draftUnit || null,
      notes: draftNotes || null,
      status: selected.status === 'missing' ? 'needs_review' : selected.status,
    });
  }, [draftNotes, draftUnit, draftValue, selected, updateSelected]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      await api.refreshAssumptions(initiativeId);
      await loadRows();
    } catch (e: any) {
      setError(e.message ?? 'Failed to refresh assumptions');
    } finally {
      setRefreshing(false);
    }
  }, [initiativeId, loadRows]);

  if (loading) return <WorkspaceTabLoader />;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-text-primary">Assumptions</h1>
              <p className="mt-1 text-sm text-text-tertiary">
                Project-wide values and claims used by modules, forecasts, and outputs.
              </p>
            </div>
            <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? 'Refreshing...' : 'Refresh extraction'}
            </button>
          </div>

          {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div> : null}

          <div className="flex flex-wrap gap-2">
            <select className="rounded-lg border border-stroke-subtle bg-white px-3 py-2 text-sm text-text-secondary" value={status} onChange={(event) => setStatus(event.target.value as '' | AssumptionStatus)}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select className="rounded-lg border border-stroke-subtle bg-white px-3 py-2 text-sm text-text-secondary" value={sourceType} onChange={(event) => setSourceType(event.target.value as '' | AssumptionSourceType)}>
              {SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select className="rounded-lg border border-stroke-subtle bg-white px-3 py-2 text-sm text-text-secondary" value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}>
              <option value="">All modules</option>
              {moduleOptions.map((module) => <option key={module} value={module}>{module.replace(/_/g, ' ')}</option>)}
            </select>
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

        <aside className="rounded-xl border border-divider bg-white p-4">
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

              <label className="block">
                <span className="text-xs font-medium text-text-tertiary">Notes</span>
                <textarea className="mt-1 min-h-[90px] w-full rounded-lg border border-stroke-subtle px-3 py-2 text-sm" value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} />
              </label>

              <div className="space-y-2 text-xs text-text-tertiary">
                <p>Source: {selected.source_type.replace('_', ' ')}</p>
                <p>Updated by: {selected.last_updated_by_email || selected.created_by_email || 'system'}</p>
                <p>Modules: {selected.used_in_modules.join(', ') || '—'}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary !px-3 !py-1.5 text-xs" onClick={handleSave} disabled={saving}>
                  Save
                </button>
                <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => updateSelected({ status: 'confirmed' })} disabled={saving}>
                  Confirm
                </button>
                <button type="button" className="btn-danger !px-3 !py-1.5 text-xs" onClick={() => updateSelected({ status: 'rejected' })} disabled={saving}>
                  Reject
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-[260px] items-center justify-center text-center">
              <div>
                <p className="text-sm font-medium text-text-secondary">Select an assumption</p>
                <p className="mt-1 text-xs text-text-tertiary">Open a row to inspect provenance, edit values, or change status.</p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
