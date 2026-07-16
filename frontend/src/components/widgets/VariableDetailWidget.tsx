'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type Variable } from '@/lib/api';
import { PROJECT_VARIABLES } from '@/lib/projectVariablesCopy';
import { VariableCommentsThread } from '@/components/variables/VariableCommentsThread';
import { formatValue, normalizeDraftValue } from '@/components/variables/VariablesWorkspaceTab';
import { useProjectStore } from '@/stores/projectStore';

const VARIABLE_UPDATED_EVENT = 'nitrogen:variable-updated';
const VARIABLE_DELETED_EVENT = 'nitrogen:variable-deleted';

interface VariableDetailWidgetProps {
  /** Prefer `variable`; `assumption` kept for dual-read of older float payloads. */
  data: { variable?: Variable; assumption?: Variable };
  onClose?: () => void;
}

function resolveVariable(data: VariableDetailWidgetProps['data']): Variable {
  const resolved = data.variable ?? data.assumption;
  if (!resolved) {
    throw new Error('VariableDetailWidget requires data.variable');
  }
  return resolved;
}

export function VariableDetailWidget({ data, onClose }: VariableDetailWidgetProps) {
  const isViewer = useProjectStore((state) => state.project?.shared_role === 'viewer');
  const [variable, setVariable] = useState<Variable>(() => resolveVariable(data));
  const [draftValue, setDraftValue] = useState('');
  const [draftUnit, setDraftUnit] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setVariable(resolveVariable(data));
  }, [data]);

  useEffect(() => {
    setDraftValue(formatValue(variable.value, null, variable.value_type));
    setDraftUnit(variable.unit ?? '');
  }, [variable]);

  // Stay in sync if the same variable is edited elsewhere (e.g. the Variables table behind this panel).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleUpdated = (event: Event) => {
      const updated = (event as CustomEvent<Variable>).detail;
      if (!updated || updated.id !== variable.id) return;
      setVariable(updated);
    };
    window.addEventListener(VARIABLE_UPDATED_EVENT, handleUpdated as EventListener);
    return () => window.removeEventListener(VARIABLE_UPDATED_EVENT, handleUpdated as EventListener);
  }, [variable.id]);

  const selectedValueText = formatValue(variable.value, null, variable.value_type);
  const hasDraftChanges = draftValue !== selectedValueText || draftUnit !== (variable.unit ?? '');
  const hasDraftValue = draftValue.trim() !== '';
  const canConfirm =
    !isViewer &&
    !deleting &&
    hasDraftValue &&
    (variable.status !== 'validated' || hasDraftChanges) &&
    !saving;
  // Delete removes the variable itself — independent of draft value/unit edits.
  const canDelete = !isViewer && !deleting;

  const updateVariable = useCallback(async (updates: Partial<Variable>) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateVariable(variable.id, updates);
      setVariable(updated);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(VARIABLE_UPDATED_EVENT, { detail: updated }));
      }
    } catch (e: any) {
      setError(e.message ?? `Failed to update ${PROJECT_VARIABLES.lowerSingular}`);
    } finally {
      setSaving(false);
    }
  }, [variable.id]);

  const handleConfirm = useCallback(async () => {
    const normalizedDraft = normalizeDraftValue(draftValue);
    let parsedValue: any = normalizedDraft;
    if (variable.value_type === 'number' || variable.value_type === 'percent' || variable.value_type === 'currency') {
      const asNumber = Number((normalizedDraft ?? '').replace(/,/g, ''));
      parsedValue = Number.isFinite(asNumber) ? asNumber : null;
    }
    await updateVariable({
      value: parsedValue,
      unit: draftUnit || null,
      status: parsedValue === null ? 'missing' : 'validated',
    });
  }, [variable.value_type, draftUnit, draftValue, updateVariable]);

  const handleCancel = useCallback(() => {
    setDraftValue(formatValue(variable.value, null, variable.value_type));
    setDraftUnit(variable.unit ?? '');
  }, [variable]);

  const handleDelete = useCallback(async () => {
    if (!canDelete) return;
    setDeleting(true);
    setError(null);
    try {
      const deletedId = variable.id;
      await api.deleteVariable(deletedId);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(VARIABLE_DELETED_EVENT, {
            detail: { variableId: deletedId, projectId: variable.project_id },
          }),
        );
      }
      onClose?.();
    } catch (e: any) {
      setError(e?.message ?? `Failed to delete ${PROJECT_VARIABLES.lowerSingular}`);
    } finally {
      setDeleting(false);
    }
  }, [variable.id, variable.project_id, canDelete, onClose]);

  return (
    <div className="space-y-4 p-4">
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div> : null}

      <label className="block">
        <span className="text-xs font-medium text-text-tertiary">Value</span>
        <input
          className="mt-1 w-full rounded-lg border border-stroke-subtle px-3 py-2 text-sm"
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          disabled={isViewer || saving || deleting}
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium text-text-tertiary">Unit</span>
        <input
          className="mt-1 w-full rounded-lg border border-stroke-subtle px-3 py-2 text-sm"
          value={draftUnit}
          onChange={(event) => setDraftUnit(event.target.value)}
          disabled={isViewer || saving || deleting}
        />
      </label>

      <div className="flex items-center justify-between gap-2">
        {isViewer ? (
          <span />
        ) : (
          <button
            type="button"
            className="btn-danger !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 inline-flex items-center shrink-0"
            onClick={() => void handleDelete()}
            disabled={!canDelete}
            title={`Delete this ${PROJECT_VARIABLES.lowerSingular}`}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 inline-flex items-center shrink-0 disabled:!opacity-100 disabled:!text-text-tertiary"
            onClick={handleCancel}
            disabled={isViewer || saving || deleting || !hasDraftChanges}
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
      </div>

      <VariableCommentsThread variableId={variable.id} />
    </div>
  );
}
