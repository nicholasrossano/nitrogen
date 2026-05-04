'use client';

import { ListChecks } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ChatPanelWidgetShell } from '@/components/core-chat/ChatPanelWidgetShell';
import { api, type Assumption } from '@/lib/api';
import { AssumptionCommentsThread } from './AssumptionCommentsThread';

const ASSUMPTION_UPDATED_EVENT = 'nitrogen:assumption-updated';
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
  initiativeId: string;
  focusAssumptionId?: string | null;
  collapsed?: boolean;
  layoutMode?: 'inline' | 'panel';
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function AssumptionsChatPanel({
  initiativeId,
  focusAssumptionId = null,
  collapsed = false,
  layoutMode = 'inline',
  onCollapsedChange,
}: AssumptionsChatPanelProps) {
  const initialCacheKey = focusAssumptionId ? `${initiativeId}:${focusAssumptionId}` : null;
  const initialCached = initialCacheKey ? assumptionCache.get(initialCacheKey) ?? null : null;
  const [selected, setSelected] = useState<Assumption | null>(initialCached);
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
      setDraftValue('');
      setDraftUnit('');
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const cacheKey = `${initiativeId}:${focusAssumptionId}`;
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
        setError(e?.message ?? 'Failed to load assumption');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [focusAssumptionId, initiativeId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleAssumptionUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<Assumption>;
      const updated = customEvent.detail;
      if (!updated || updated.initiative_id !== initiativeId) return;
      const cacheKey = `${initiativeId}:${updated.id}`;
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
  }, [focusAssumptionId, initiativeId]);

  const selectedValueText = selected ? formatAssumptionValue(selected.value, null, selected.value_type) : '';
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
      assumptionCache.set(`${initiativeId}:${updated.id}`, updated);
      setSelected(updated);
      setDraftValue(formatAssumptionValue(updated.value, null, updated.value_type));
      setDraftUnit(updated.unit ?? '');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(ASSUMPTION_UPDATED_EVENT, { detail: updated }),
        );
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to update assumption');
    } finally {
      setSaving(false);
    }
  }, [draftUnit, draftValue, initiativeId, selected]);

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateAssumption(selected.id, {
        value: null,
        unit: null,
        status: 'missing',
      });
      assumptionCache.set(`${initiativeId}:${updated.id}`, updated);
      setSelected(updated);
      setDraftValue(formatAssumptionValue(updated.value, null, updated.value_type));
      setDraftUnit(updated.unit ?? '');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(ASSUMPTION_UPDATED_EVENT, { detail: updated }),
        );
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete assumption');
    } finally {
      setSaving(false);
    }
  }, [initiativeId, selected]);

  return (
    <ChatPanelWidgetShell
      icon={<ListChecks className="h-3.5 w-3.5 text-accent" />}
      eyebrow="Assumptions"
      title={selected?.label ?? (focusAssumptionId ? 'Loading assumption...' : 'No assumption selected')}
      collapsed={collapsed}
      layoutMode={layoutMode}
      onCollapsedChange={onCollapsedChange}
    >
      {!focusAssumptionId ? (
        <div>
          <p className="text-sm font-medium text-text-secondary">No assumption selected</p>
          <p className="mt-1 text-xs text-text-tertiary">
            Select a row in the assumptions table, or ask chat to add a new assumption.
          </p>
        </div>
      ) : loading || (!selected && !error) ? (
        <p className="text-sm text-text-tertiary">Loading selected assumption...</p>
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
      ) : (
        <p className="text-sm text-text-tertiary">Unable to load selected assumption.</p>
      )}
    </ChatPanelWidgetShell>
  );
}
