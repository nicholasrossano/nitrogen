'use client';

import { ListChecks } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ChatPanelWidgetShell } from '@/components/core-chat/ChatPanelWidgetShell';
import { api, type Assumption } from '@/lib/api';
import { AssumptionCommentsThread } from './AssumptionCommentsThread';

interface AssumptionsChatPanelProps {
  initiativeId: string;
  focusAssumptionId?: string | null;
  collapsed?: boolean;
  layoutMode?: 'inline' | 'panel';
  onCollapsedChange?: (collapsed: boolean) => void;
  onClose?: () => void;
}

export function AssumptionsChatPanel({
  initiativeId,
  focusAssumptionId = null,
  collapsed = false,
  layoutMode = 'inline',
  onCollapsedChange,
  onClose,
}: AssumptionsChatPanelProps) {
  const [selected, setSelected] = useState<Assumption | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [draftUnit, setDraftUnit] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatValue = useCallback((value: any, unit?: string | null): string => {
    if (value === null || value === undefined || value === '') return '—';
    const formatted = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return unit ? `${formatted} ${unit}` : formatted;
  }, []);

  useEffect(() => {
    if (!focusAssumptionId) {
      setSelected(null);
      setDraftValue('');
      setDraftUnit('');
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void api.listAssumptions(initiativeId)
      .then((allAssumptions) => {
        if (cancelled) return;
        const assumption = allAssumptions.find((row) => row.id === focusAssumptionId);
        if (!assumption) {
          setError('Selected assumption no longer exists');
          setSelected(null);
          return;
        }
        setSelected(assumption);
        setDraftValue(formatValue(assumption.value, null));
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
  }, [focusAssumptionId, formatValue, initiativeId]);

  const selectedValueText = selected ? formatValue(selected.value, null) : '';
  const hasDraftChanges = useMemo(() => Boolean(
    selected && (
      draftValue !== selectedValueText ||
      draftUnit !== (selected.unit ?? '')
    ),
  ), [draftUnit, draftValue, selected, selectedValueText]);
  const hasDraftValue = draftValue.trim() !== '' && draftValue.trim() !== '—';
  const canConfirm = Boolean(
    selected &&
    hasDraftValue &&
    (selected.status !== 'confirmed' || hasDraftChanges) &&
    !saving,
  );

  const handleCancel = useCallback(() => {
    if (!selected) return;
    setDraftValue(formatValue(selected.value, null));
    setDraftUnit(selected.unit ?? '');
  }, [formatValue, selected]);

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
        status: 'confirmed',
      });
      setSelected(updated);
      setDraftValue(formatValue(updated.value, null));
      setDraftUnit(updated.unit ?? '');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to update assumption');
    } finally {
      setSaving(false);
    }
  }, [draftUnit, draftValue, formatValue, selected]);

  return (
    <ChatPanelWidgetShell
      icon={<ListChecks className="h-3.5 w-3.5 text-accent" />}
      eyebrow="Assumptions"
      title={selected?.label ?? 'No assumption selected'}
      collapsed={collapsed}
      layoutMode={layoutMode}
      onCollapsedChange={onCollapsedChange}
      onClose={onClose}
    >
      {!focusAssumptionId ? (
        <div>
          <p className="text-sm font-medium text-text-secondary">No assumption selected</p>
          <p className="mt-1 text-xs text-text-tertiary">Select a row in the assumptions table to open it here.</p>
        </div>
      ) : loading ? (
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
              className="btn-secondary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 inline-flex items-center shrink-0"
              onClick={handleCancel}
              disabled={saving || !hasDraftChanges}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 inline-flex items-center shrink-0"
              onClick={() => void handleConfirm()}
              disabled={!canConfirm}
            >
              Confirm
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
