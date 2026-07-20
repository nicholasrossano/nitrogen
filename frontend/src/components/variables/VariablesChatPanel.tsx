'use client';

import { ListChecks } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ChatPanelWidgetShell } from '@/components/core-chat/ChatPanelWidgetShell';
import { api, type Variable } from '@/lib/api';
import { formatVariableValue } from '@/lib/formatVariableValue';
import { PROJECT_VARIABLES } from '@/lib/projectVariablesCopy';
import { VariableCommentsThread } from './VariableCommentsThread';

const VARIABLE_UPDATED_EVENT = 'nitrogen:variable-updated';
const VARIABLE_DELETED_EVENT = 'nitrogen:variable-deleted';
const variableCache = new Map<string, Variable>();

interface VariablesChatPanelProps {
  projectId: string;
  focusVariableId?: string | null;
  createNew?: boolean;
  collapsed?: boolean;
  layoutMode?: 'inline' | 'panel';
  onCollapsedChange?: (collapsed: boolean) => void;
}

function normalizeVariableKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseDraftValue(raw: string): {
  value: any;
  status: 'missing' | 'assumed';
  valueType: Variable['value_type'];
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

export function VariablesChatPanel({
  projectId,
  focusVariableId = null,
  createNew = false,
  collapsed = false,
  layoutMode = 'inline',
  onCollapsedChange,
}: VariablesChatPanelProps) {
  const initialCacheKey = focusVariableId ? `${projectId}:${focusVariableId}` : null;
  const initialCached = initialCacheKey ? variableCache.get(initialCacheKey) ?? null : null;
  const initialCreateMode = createNew && !focusVariableId;
  const [selected, setSelected] = useState<Variable | null>(initialCached);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftValue, setDraftValue] = useState(
    initialCached ? formatVariableValue(initialCached.value, null, initialCached.value_type) : '',
  );
  const [draftUnit, setDraftUnit] = useState(initialCached?.unit ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(Boolean(focusVariableId && !initialCached));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!focusVariableId) {
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
    const cacheKey = `${projectId}:${focusVariableId}`;
    const cached = variableCache.get(cacheKey);
    if (cached) {
      setSelected(cached);
      setDraftValue(formatVariableValue(cached.value, null, cached.value_type));
      setDraftUnit(cached.unit ?? '');
      setLoading(false);
    } else {
      setSelected(null);
      setDraftValue('');
      setDraftUnit('');
      setLoading(true);
    }
    setError(null);
    void api.getVariable(focusVariableId)
      .then((variable) => {
        if (cancelled) return;
        variableCache.set(cacheKey, variable);
        setSelected(variable);
        setDraftValue(formatVariableValue(variable.value, null, variable.value_type));
        setDraftUnit(variable.unit ?? '');
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
  }, [focusVariableId, projectId, initialCreateMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleVariableUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<Variable>;
      const updated = customEvent.detail;
      if (!updated || updated.project_id !== projectId) return;
      const cacheKey = `${projectId}:${updated.id}`;
      variableCache.set(cacheKey, updated);
      if (focusVariableId === updated.id) {
        setSelected(updated);
        setDraftValue(formatVariableValue(updated.value, null, updated.value_type));
        setDraftUnit(updated.unit ?? '');
      }
    };

    window.addEventListener(VARIABLE_UPDATED_EVENT, handleVariableUpdated as EventListener);
    return () => {
      window.removeEventListener(VARIABLE_UPDATED_EVENT, handleVariableUpdated as EventListener);
    };
  }, [focusVariableId, projectId]);

  const selectedValueText = selected ? formatVariableValue(selected.value, null, selected.value_type) : '';
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
    !saving &&
    !deleting,
  );
  // Delete removes the variable itself — independent of draft value/unit edits.
  const canDelete = Boolean(selected && !deleting);
  const canCreate = Boolean(
    !saving &&
    normalizeVariableKey(draftLabel).length > 0,
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
      const updated = await api.updateVariable(selected.id, {
        value: parsedValue,
        unit: draftUnit || null,
        status: 'validated',
      });
      variableCache.set(`${projectId}:${updated.id}`, updated);
      setSelected(updated);
      setDraftValue(formatVariableValue(updated.value, null, updated.value_type));
      setDraftUnit(updated.unit ?? '');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(VARIABLE_UPDATED_EVENT, { detail: updated }),
        );
      }
    } catch (e: any) {
      setError(e?.message ?? `Failed to update ${PROJECT_VARIABLES.lowerSingular}`);
    } finally {
      setSaving(false);
    }
  }, [draftUnit, draftValue, projectId, selected]);

  const handleDelete = useCallback(async () => {
    if (!selected || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const deletedId = selected.id;
      await api.deleteVariable(deletedId);
      variableCache.delete(`${projectId}:${deletedId}`);
      setSelected(null);
      setDraftLabel('');
      setDraftValue('');
      setDraftUnit('');
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
  }, [deleting, projectId, selected]);

  const handleCreate = useCallback(async () => {
    const key = normalizeVariableKey(draftLabel);
    if (!key) return;
    const label = draftLabel.trim();
    if (!label) return;
    const parsed = parseDraftValue(draftValue);

    setSaving(true);
    setError(null);
    try {
      const created = await api.createVariable(projectId, {
        key,
        label,
        value: parsed.value,
        unit: draftUnit || null,
        value_type: parsed.valueType,
        source_type: 'user_input',
        status: parsed.status,
      });
      variableCache.set(`${projectId}:${created.id}`, created);
      setSelected(created);
      setDraftValue(formatVariableValue(created.value, null, created.value_type));
      setDraftUnit(created.unit ?? '');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(VARIABLE_UPDATED_EVENT, { detail: created }),
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
      title={selected?.label ?? (showCreateForm ? `New ${PROJECT_VARIABLES.lowerSingular}` : (focusVariableId ? `Loading ${PROJECT_VARIABLES.lowerSingular}...` : `No ${PROJECT_VARIABLES.lowerSingular} selected`))}
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
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="btn-danger !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 inline-flex items-center shrink-0"
              onClick={() => void handleDelete()}
              disabled={!canDelete}
              title={`Delete this ${PROJECT_VARIABLES.lowerSingular}`}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 inline-flex items-center shrink-0 disabled:!opacity-100 disabled:!text-text-tertiary"
                onClick={() => {
                  if (!selected) return;
                  setDraftValue(formatVariableValue(selected.value, null, selected.value_type));
                  setDraftUnit(selected.unit ?? '');
                }}
                disabled={saving || deleting || !hasDraftChanges}
              >
                Cancel
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
          </div>
          <VariableCommentsThread variableId={selected.id} />
        </div>
      ) : !focusVariableId ? (
        <div>
          <p className="text-sm font-medium text-text-secondary">No {PROJECT_VARIABLES.lowerSingular} selected</p>
          <p className="mt-1 text-xs text-text-tertiary">
            Select a row in the {PROJECT_VARIABLES.lower} table, or ask chat to add a new {PROJECT_VARIABLES.lowerSingular}.
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
