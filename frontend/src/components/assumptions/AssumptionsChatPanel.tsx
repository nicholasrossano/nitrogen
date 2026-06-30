'use client';

import { ListChecks } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ChatPanelWidgetShell } from '@/components/core-chat/ChatPanelWidgetShell';
import { api, type Assumption } from '@/lib/api';
import { PROJECT_VARIABLES } from '@/lib/projectVariablesCopy';
import { AssumptionCommentsThread } from './AssumptionCommentsThread';

const ASSUMPTION_UPDATED_EVENT = 'nitrogen:assumption-updated';
const ASSUMPTION_DELETED_EVENT = 'nitrogen:assumption-deleted';
const assumptionCache = new Map<string, Assumption>();

function formatAssumptionValue(
  value: any,
  unit?: string | null,
  valueType?: Assumption['value_type'],
): string {
  if (value === null || value === undefined || value === '') return '';
  const formatted = typeof value === 'number'
    ? (
        valueType === 'currency'
          ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
          : Number.isInteger(value)
            ? value.toLocaleString()
            : value.toLocaleString(undefined, { maximumFractionDigits: 6 })
      )
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

interface AssumptionsChatPanelProps {
  projectId: string;
  focusAssumptionId?: string | null;
  createNew?: boolean;
  collapsed?: boolean;
  layoutMode?: 'inline' | 'panel';
  onCollapsedChange?: (collapsed: boolean) => void;
}

function normalizeAssumptionKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseDraftValue(raw: string): {
  value: any;
  status: 'missing' | 'assumed';
  valueType: Assumption['value_type'];
} {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, status: 'missing', valueType: 'text' };
  if (trimmed.toLowerCase() === 'true' || trimmed.toLowerCase() === 'false') {
    return {
      value: trimmed.toLowerCase() === 'true',
      status: 'assumed',
      valueType: 'boolean',
    };
  }
  const asNumber = Number(trimmed.replace(/,/g, ''));
  if (Number.isFinite(asNumber)) {
    return { value: asNumber, status: 'assumed', valueType: 'number' };
  }
  return {
    value: trimmed,
    status: 'assumed',
    valueType: trimmed.length > 120 ? 'text' : 'string',
  };
}

export function AssumptionsChatPanel({
  projectId,
  focusAssumptionId = null,
  createNew = false,
  collapsed = false,
  layoutMode = 'inline',
  onCollapsedChange,
}: AssumptionsChatPanelProps) {
  const initialCacheKey = focusAssumptionId ? `${projectId}:${focusAssumptionId}` : null;
  const initialCached = initialCacheKey ? assumptionCache.get(initialCacheKey) ?? null : null;
  const initialCreateMode = createNew && !focusAssumptionId;
  const [selected, setSelected] = useState<Assumption | null>(initialCached);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftValue, setDraftValue] = useState(
    initialCached ? formatAssumptionValue(initialCached.value, null, initialCached.value_type) : '',
  );
  const [draftUnit, setDraftUnit] = useState(initialCached?.unit ?? '');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(focusAssumptionId && !initialCached));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!focusAssumptionId) {
      setSelected(null);
      if (initialCreateMode) {
        setDraftLabel('');
      }
      setDraftValue('');
      setDraftUnit('');
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const cacheKey = `${projectId}:${focusAssumptionId}`;
    const cached = assumptionCache.get(cacheKey);
    if (cached) {
      setSelected(cached);
      setDraftValue(formatAssumptionValue(cached.value, null, cached.value_type));
      setDraftUnit(cached.unit ?? '');
      setLoading(false);
    } else {
      setSelected(null);
      setDraftValue('');
      setDraftUnit('');
      setLoading(true);
    }
    setError(null);
    void api.getAssumption(focusAssumptionId)
      .then((assumption) => {
        if (cancelled) return;
        assumptionCache.set(cacheKey, assumption);
        setSelected(assumption);
        setDraftValue(formatAssumptionValue(assumption.value, null, assumption.value_type));
        setDraftUnit(assumption.unit ?? '');
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message ?? `Failed to load ${PROJECT_VARIABLES.lowerSingular}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [focusAssumptionId, projectId, initialCreateMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleAssumptionUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<Assumption>;
      const updated = customEvent.detail;
      if (!updated || updated.project_id !== projectId) return;
      const cacheKey = `${projectId}:${updated.id}`;
      assumptionCache.set(cacheKey, updated);
      if (focusAssumptionId === updated.id) {
        setSelected(updated);
        setDraftValue(formatAssumptionValue(updated.value, null, updated.value_type));
        setDraftUnit(updated.unit ?? '');
      }
    };

    window.addEventListener(ASSUMPTION_UPDATED_EVENT, handleAssumptionUpdated as EventListener);
    return () => {
      window.removeEventListener(ASSUMPTION_UPDATED_EVENT, handleAssumptionUpdated as EventListener);
    };
  }, [focusAssumptionId, projectId]);

  const selectedValueText = selected ? formatAssumptionValue(selected.value, null, selected.value_type) : '';
  const showCreateForm = initialCreateMode && !selected;
  const hasDraftChanges = useMemo(() => Boolean(
    selected && (
      draftValue !== selectedValueText ||
      draftUnit !== (selected.unit ?? '')
    ),
  ), [draftUnit, draftValue, selected, selectedValueText]);
  const hasDraftValue = draftValue.trim() !== '';
  const canConfirm = Boolean(
    selected &&
    hasDraftValue &&
    (selected.status !== 'validated' || hasDraftChanges) &&
    !saving,
  );
  const canDelete = Boolean(selected && !saving);
  const canCreate = Boolean(
    !saving &&
    normalizeAssumptionKey(draftLabel).length > 0,
  );

  const handleConfirm = useCallback(async () => {
    if (!selected) return;
    let parsedValue: any = draftValue;
    if (selected.value_type === 'number' || selected.value_type === 'percent' || selected.value_type === 'currency') {
      const asNumber = Number(draftValue.replace(/,/g, ''));
      parsedValue = Number.isFinite(asNumber) ? asNumber : draftValue;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateAssumption(selected.id, {
        value: parsedValue,
        unit: draftUnit || null,
        status: 'validated',
      });
      assumptionCache.set(`${projectId}:${updated.id}`, updated);
      setSelected(updated);
      setDraftValue(formatAssumptionValue(updated.value, null, updated.value_type));
      setDraftUnit(updated.unit ?? '');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(ASSUMPTION_UPDATED_EVENT, { detail: updated }),
        );
      }
    } catch (e: any) {
      setError(e?.message ?? `Failed to update ${PROJECT_VARIABLES.lowerSingular}`);
    } finally {
      setSaving(false);
    }
  }, [draftUnit, draftValue, projectId, selected]);

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const deletedId = selected.id;
      await api.deleteAssumption(deletedId);
      assumptionCache.delete(`${projectId}:${deletedId}`);
      setSelected(null);
      setDraftLabel('');
      setDraftValue('');
      setDraftUnit('');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(ASSUMPTION_DELETED_EVENT, {
            detail: { assumptionId: deletedId, projectId },
          }),
        );
      }
    } catch (e: any) {
      setError(e?.message ?? `Failed to delete ${PROJECT_VARIABLES.lowerSingular}`);
    } finally {
      setSaving(false);
    }
  }, [projectId, selected]);

  const handleCreate = useCallback(async () => {
    const key = normalizeAssumptionKey(draftLabel);
    if (!key) return;
    const label = draftLabel.trim();
    if (!label) return;
    const parsed = parseDraftValue(draftValue);

    setSaving(true);
    setError(null);
    try {
      const created = await api.createAssumption(projectId, {
        key,
        label,
        value: parsed.value,
        unit: draftUnit || null,
        value_type: parsed.valueType,
        source_type: 'user_input',
        status: parsed.status,
      });
      assumptionCache.set(`${projectId}:${created.id}`, created);
      setSelected(created);
      setDraftValue(formatAssumptionValue(created.value, null, created.value_type));
      setDraftUnit(created.unit ?? '');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(ASSUMPTION_UPDATED_EVENT, { detail: created }),
        );
      }
    } catch (e: any) {
      setError(e?.message ?? `Failed to create ${PROJECT_VARIABLES.lowerSingular}`);
    } finally {
      setSaving(false);
    }
  }, [draftLabel, draftUnit, draftValue, projectId]);

  const handleCreateCancel = useCallback(() => {
    setDraftLabel('');
    setDraftValue('');
    setDraftUnit('');
    setError(null);
  }, []);

  return (
    <ChatPanelWidgetShell
      icon={<ListChecks className="h-3.5 w-3.5 text-accent" />}
      eyebrow={PROJECT_VARIABLES.title}
      title={selected?.label ?? (showCreateForm ? `New ${PROJECT_VARIABLES.lowerSingular}` : (focusAssumptionId ? `Loading ${PROJECT_VARIABLES.lowerSingular}...` : `No ${PROJECT_VARIABLES.lowerSingular} selected`))}
      collapsed={collapsed}
      layoutMode={layoutMode}
      onCollapsedChange={onCollapsedChange}
    >
      {showCreateForm ? (
        <div className="space-y-4">
          {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div> : null}
          <label className="block">
            <span className="text-xs font-medium text-text-tertiary">{PROJECT_VARIABLES.titleSingular} name</span>
            <input
              className="mt-1 w-full rounded-lg border border-stroke-subtle px-3 py-2 text-sm"
              value={draftLabel}
              onChange={(event) => setDraftLabel(event.target.value)}
              placeholder="e.g. PPA price per MWh"
            />
          </label>
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
              onClick={handleCreateCancel}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 inline-flex items-center shrink-0"
              onClick={() => void handleCreate()}
              disabled={!canCreate}
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      ) : selected ? (
        <div className="space-y-4">
          {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div> : null}
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
              className="btn-danger !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 inline-flex items-center shrink-0"
              onClick={() => void handleDelete()}
              disabled={!canDelete}
            >
              {saving ? 'Deleting...' : 'Delete'}
            </button>
            <button
              type="button"
              className="btn-primary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 inline-flex items-center shrink-0"
              onClick={() => void handleConfirm()}
              disabled={!canConfirm}
            >
              {saving ? 'Saving...' : 'Confirm'}
            </button>
          </div>
          <AssumptionCommentsThread assumptionId={selected.id} />
        </div>
      ) : !focusAssumptionId ? (
        <div>
          <p className="text-sm font-medium text-text-secondary">No {PROJECT_VARIABLES.lowerSingular} selected</p>
          <p className="mt-1 text-xs text-text-tertiary">
            Select a row in the assumptions table, or ask chat to add a new assumption.
          </p>
        </div>
      ) : loading ? (
        <p className="text-sm text-text-tertiary">Loading selected {PROJECT_VARIABLES.lowerSingular}...</p>
      ) : (
        <p className="text-sm text-text-tertiary">Unable to load selected {PROJECT_VARIABLES.lowerSingular}.</p>
      )}
    </ChatPanelWidgetShell>
  );
}
