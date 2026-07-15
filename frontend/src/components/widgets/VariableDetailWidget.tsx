'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type Assumption } from '@/lib/api';
import { PROJECT_VARIABLES } from '@/lib/projectVariablesCopy';
import { AssumptionCommentsThread } from '@/components/assumptions/AssumptionCommentsThread';
import { formatValue, normalizeDraftValue } from '@/components/assumptions/AssumptionsWorkspaceTab';

const ASSUMPTION_UPDATED_EVENT = 'nitrogen:assumption-updated';

interface VariableDetailWidgetProps {
  data: { assumption: Assumption };
}

export function VariableDetailWidget({ data }: VariableDetailWidgetProps) {
  const [assumption, setAssumption] = useState<Assumption>(data.assumption);
  const [draftValue, setDraftValue] = useState('');
  const [draftUnit, setDraftUnit] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAssumption(data.assumption);
  }, [data.assumption]);

  useEffect(() => {
    setDraftValue(formatValue(assumption.value, null, assumption.value_type));
    setDraftUnit(assumption.unit ?? '');
  }, [assumption]);

  // Stay in sync if the same variable is edited elsewhere (e.g. the Variables table behind this panel).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleUpdated = (event: Event) => {
      const updated = (event as CustomEvent<Assumption>).detail;
      if (!updated || updated.id !== assumption.id) return;
      setAssumption(updated);
    };
    window.addEventListener(ASSUMPTION_UPDATED_EVENT, handleUpdated as EventListener);
    return () => window.removeEventListener(ASSUMPTION_UPDATED_EVENT, handleUpdated as EventListener);
  }, [assumption.id]);

  const selectedValueText = formatValue(assumption.value, null, assumption.value_type);
  const hasDraftChanges = draftValue !== selectedValueText || draftUnit !== (assumption.unit ?? '');
  const hasDraftValue = draftValue.trim() !== '';
  const canConfirm = hasDraftValue && (assumption.status !== 'validated' || hasDraftChanges) && !saving;

  const updateAssumption = useCallback(async (updates: Partial<Assumption>) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateAssumption(assumption.id, updates);
      setAssumption(updated);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(ASSUMPTION_UPDATED_EVENT, { detail: updated }));
      }
    } catch (e: any) {
      setError(e.message ?? `Failed to update ${PROJECT_VARIABLES.lowerSingular}`);
    } finally {
      setSaving(false);
    }
  }, [assumption.id]);

  const handleConfirm = useCallback(async () => {
    const normalizedDraft = normalizeDraftValue(draftValue);
    let parsedValue: any = normalizedDraft;
    if (assumption.value_type === 'number' || assumption.value_type === 'percent' || assumption.value_type === 'currency') {
      const asNumber = Number((normalizedDraft ?? '').replace(/,/g, ''));
      parsedValue = Number.isFinite(asNumber) ? asNumber : null;
    }
    await updateAssumption({
      value: parsedValue,
      unit: draftUnit || null,
      status: parsedValue === null ? 'missing' : 'validated',
    });
  }, [assumption.value_type, draftUnit, draftValue, updateAssumption]);

  const handleCancel = useCallback(() => {
    setDraftValue(formatValue(assumption.value, null, assumption.value_type));
    setDraftUnit(assumption.unit ?? '');
  }, [assumption]);

  return (
    <div className="space-y-4 p-4">
      <p className="text-xs text-text-tertiary">{assumption.key}</p>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div> : null}

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

      <AssumptionCommentsThread assumptionId={assumption.id} />
    </div>
  );
}
