'use client';

import { useState, useCallback, useEffect, useMemo, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Plus, Trash2, Check, X } from 'lucide-react';
import type { BuildItem, FieldContext, FieldDef } from '@/lib/api';
import { api } from '@/lib/api';
import { buildModelInputsContext } from '@/lib/modelInputsContext';
import { PageLoader } from '@/components/ui/PageLoader';
import {
  PROPOSAL_MODEL_TYPES_BY_MODULE_ID,
  SOLAR_LOCATION_MODULE_ID,
  TABLE_CATEGORY_LABELS,
  TABLE_CATEGORY_ORDER,
  TECHNOLOGY_TYPE_OPTIONS,
} from '@/first-party/modelInputs';

interface Props {
  instanceId: string;
  moduleId: string;
  stageId: string;
  workflowVersion?: number;
  fields: FieldDef[];
  items: BuildItem[];
  isLoading?: boolean;
  interactionLocked?: boolean;
  allowAddRows: boolean;
  readOnly?: boolean;
  flush?: boolean;
  onChanged: () => void;
}

const INVESTIGATE_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='%231a1a1a' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='6.5' cy='6.5' r='4.5'/%3E%3Cline x1='10' y1='10' x2='14.5' y2='14.5'/%3E%3C/svg%3E") 6 6, auto`;
const SolarLocationMap = lazy(() => import('@/components/widgets/solar/SolarLocationMap'));

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function formatCategoryLabel(category: string): string {
  return category
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// ── Inline value editor ──────────────────────────────────────────────────

function ValueEditor({
  value,
  fieldType,
  options,
  onSave,
}: {
  value: any;
  fieldType: string;
  options?: string[] | null;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ''));

  const commit = () => {
    setEditing(false);
    onSave(draft);
  };

  if (!editing) {
    const display = value !== null && value !== undefined && value !== '' ? String(value) : null;
    return (
      <button
        onClick={() => { setDraft(String(value ?? '')); setEditing(true); }}
        className="group inline-flex items-center gap-1.5 text-xs font-mono tabular-nums text-text-primary hover:text-accent transition-colors"
      >
        {display !== null ? (
          <span>{display}</span>
        ) : (
          <span className="text-text-tertiary italic text-[11px]">—</span>
        )}
        <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-50 transition-opacity shrink-0" />
      </button>
    );
  }

  if (fieldType === 'select' && options?.length) {
    return (
      <select
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className="text-xs bg-surface border border-accent/40 rounded px-1.5 py-0.5 outline-none text-text-primary font-mono"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      autoFocus
      type={fieldType === 'number' ? 'number' : 'text'}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { setDraft(String(value ?? '')); setEditing(false); }
      }}
      className="w-24 text-xs text-right font-mono bg-surface border border-accent/40 rounded px-1.5 py-0.5 outline-none text-text-primary"
    />
  );
}

// ── Single row ─────────────────────────────────────────────────────────────

function TableRow({
  item,
  fields,
  onSave,
  onDelete,
  readOnly,
  investigateEnabled,
  onInvestigateHoverMove,
  onInvestigateHoverLeave,
  onInvestigate,
}: {
  item: BuildItem;
  fields: FieldDef[];
  onSave: (fieldName: string, value: string) => void;
  onDelete: () => void;
  readOnly?: boolean;
  investigateEnabled?: boolean;
  onInvestigateHoverMove?: (e: React.MouseEvent, isInteractive: boolean) => void;
  onInvestigateHoverLeave?: () => void;
  onInvestigate?: (e: React.MouseEvent) => void;
}) {
  const nameField = fields[0];
  const valueField = fields.find((f) => f.name === 'value') ?? fields[1] ?? fields[0];
  const unitField = fields.find((f) => f.name === 'unit');

  const name = String(item.content[nameField?.name ?? 'variable'] ?? '');
  const unit = unitField ? String(item.content[unitField.name] ?? '') : '';
  const status: string = item.content.status ?? (item.origin === 'inferred' ? 'inferred' : '');
  const explicitFieldName = String(item.content.field_name ?? '');
  const normalizedFieldName = explicitFieldName || normalizeKey(name);
  const rowFieldType = String(item.content.field_type ?? (valueField?.field_type ?? 'text'));
  const rowOptions = Array.isArray(item.content.options)
    ? (item.content.options as string[])
    : normalizedFieldName === 'technology_type'
      ? TECHNOLOGY_TYPE_OPTIONS
      : null;

  const STATUS_STYLES: Record<string, string> = {
    validated: 'bg-green-50 text-green-700',
    confirmed: 'bg-green-50 text-green-700',
    inferred: 'bg-blue-50 text-blue-700',
    assumed: 'bg-amber-50 text-amber-700',
    missing: 'bg-red-50 text-red-600',
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-subtle/50 transition-colors group border-b border-stroke-subtle last:border-0"
      style={investigateEnabled ? { cursor: INVESTIGATE_CURSOR } : undefined}
      onMouseMove={(e) => {
        if (!investigateEnabled || !onInvestigateHoverMove) return;
        const isInteractive = !!(e.target as HTMLElement).closest('button, input, select, a');
        onInvestigateHoverMove(e, isInteractive);
      }}
      onMouseLeave={() => {
        if (!investigateEnabled || !onInvestigateHoverLeave) return;
        onInvestigateHoverLeave();
      }}
      onClick={(e) => {
        if (!investigateEnabled || !onInvestigate) return;
        if ((e.target as HTMLElement).closest('button, input, select, a')) return;
        onInvestigate(e);
      }}
    >
      {/* Variable name */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-text-primary truncate">{name}</span>
          {unit && <span className="text-[10px] text-text-tertiary shrink-0">({unit})</span>}
        </div>
        {item.content.rationale && status === 'assumed' && (
          <p className="text-[10px] text-amber-600 mt-0.5 truncate">{item.content.rationale}</p>
        )}
      </div>

      {/* Status badge */}
      {status && STATUS_STYLES[status] && (
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${STATUS_STYLES[status]}`}>
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
      )}

      {/* Value */}
      <div className="w-28 flex justify-end shrink-0">
        {readOnly ? (
          <span className="text-xs font-mono tabular-nums text-text-primary">
            {valueField && item.content[valueField.name] !== null && item.content[valueField.name] !== undefined
              ? String(item.content[valueField.name]).replace(/_/g, ' ')
              : <span className="text-text-tertiary italic">—</span>}
          </span>
        ) : (
          valueField && (
            <ValueEditor
              value={item.content[valueField.name]}
              fieldType={rowFieldType}
              options={rowOptions}
              onSave={(v) => onSave(valueField.name, v)}
            />
          )
        )}
      </div>

      {/* Delete */}
      {!readOnly && (
        <button
          onClick={onDelete}
          className="p-0.5 text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all shrink-0"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ── Add row form ──────────────────────────────────────────────────────────

function AddRowForm({
  fields,
  onSubmit,
  onCancel,
}: {
  fields: FieldDef[];
  onSubmit: (content: Record<string, any>) => void;
  onCancel: () => void;
}) {
  const nameField = fields[0];
  const valueField = fields.find((f) => f.field_type === 'number') ?? fields[1];
  const unitField = fields.find((f) => f.name === 'unit');

  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const content: Record<string, any> = {};
    if (nameField) content[nameField.name] = name;
    if (valueField) content[valueField.name] = value !== '' ? Number(value) : null;
    if (unitField) content[unitField.name] = unit;
    onSubmit(content);
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-accent/5 border-t border-divider">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onCancel(); }}
        placeholder={nameField?.placeholder ?? nameField?.label ?? 'Variable name'}
        className="flex-1 text-xs bg-surface border border-accent/40 rounded px-2 py-1 outline-none text-text-primary"
      />
      {valueField && (
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onCancel(); }}
          placeholder="Value"
          className="w-20 text-xs text-right font-mono bg-surface border border-accent/40 rounded px-2 py-1 outline-none text-text-primary"
        />
      )}
      {unitField && (
        <input
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onCancel(); }}
          placeholder="Unit"
          className="w-16 text-xs bg-surface border border-accent/40 rounded px-2 py-1 outline-none text-text-primary"
        />
      )}
      <button onClick={handleSubmit} disabled={saving || !name.trim()} className="p-1 text-emerald-600 enabled:hover:text-emerald-700 disabled:opacity-40">
        <Check className="w-3.5 h-3.5" />
      </button>
      <button onClick={onCancel} className="p-1 text-text-tertiary hover:text-text-secondary">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function EditableTableStage({
  instanceId,
  moduleId,
  stageId,
  workflowVersion,
  fields,
  items,
  isLoading = false,
  interactionLocked = false,
  allowAddRows,
  readOnly,
  flush = false,
  onChanged,
}: Props) {
  const [optimisticContentByItemId, setOptimisticContentByItemId] = useState<Record<string, Record<string, any>>>({});
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [hoveredInvestigateRow, setHoveredInvestigateRow] = useState<{
    fieldName: string;
    label: string;
    status: string;
  } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [overInteractive, setOverInteractive] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isUpdatingSolarLocation, setIsUpdatingSolarLocation] = useState(false);
  const interactionsDisabled = !!readOnly || interactionLocked;

  const proposalModelType = PROPOSAL_MODEL_TYPES_BY_MODULE_ID[moduleId] ?? null;
  const enableInvestigate = !!proposalModelType && stageId === 'inputs' && !interactionsDisabled;
  const isSolarInputsStage = moduleId === SOLAR_LOCATION_MODULE_ID && stageId === 'inputs';

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (interactionsDisabled) {
      setAdding(false);
    }
  }, [interactionsDisabled]);

  const effectiveItems = items.map((item) => {
    const optimisticContent = optimisticContentByItemId[item.id];
    if (!optimisticContent) return item;
    return {
      ...item,
      content: {
        ...item.content,
        ...optimisticContent,
      },
    };
  });

  const findFieldRow = useCallback(
    (fieldName: string) =>
      effectiveItems.find((item) => {
        const explicitFieldName = typeof item.content.field_name === 'string'
          ? item.content.field_name
          : '';
        const variable = typeof item.content.variable === 'string'
          ? item.content.variable
          : '';
        return explicitFieldName === fieldName || normalizeKey(variable) === fieldName;
      }),
    [effectiveItems]
  );

  const solarAddressRow = isSolarInputsStage ? findFieldRow('address') : undefined;
  const solarLatRow = isSolarInputsStage ? findFieldRow('lat') : undefined;
  const solarLonRow = isSolarInputsStage ? findFieldRow('lon') : undefined;
  const shouldShowSolarLocationMap = !!(isSolarInputsStage && (solarAddressRow || solarLatRow || solarLonRow));
  const solarAddress = typeof solarAddressRow?.content?.value === 'string' && solarAddressRow.content.value.trim()
    ? solarAddressRow.content.value
    : null;
  const solarLat = typeof solarLatRow?.content?.value === 'number'
    ? solarLatRow.content.value
    : typeof solarLatRow?.content?.value === 'string' && solarLatRow.content.value.trim() !== ''
      ? Number(solarLatRow.content.value)
      : null;
  const solarLon = typeof solarLonRow?.content?.value === 'number'
    ? solarLonRow.content.value
    : typeof solarLonRow?.content?.value === 'string' && solarLonRow.content.value.trim() !== ''
      ? Number(solarLonRow.content.value)
      : null;

  useEffect(() => {
    if (Object.keys(optimisticContentByItemId).length === 0) return;
    setOptimisticContentByItemId((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [itemId, optimisticContent] of Object.entries(prev)) {
        const serverItem = items.find((it) => it.id === itemId);
        if (!serverItem) {
          delete next[itemId];
          changed = true;
          continue;
        }
        const applied = Object.entries(optimisticContent).every(
          ([field, value]) => serverItem.content?.[field] === value
        );
        if (applied) {
          delete next[itemId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [items, optimisticContentByItemId]);

  // Group by category if items have a category field in content
  const hasCategories = effectiveItems.some((item) => item.content.category);
  const encounteredCategories = Array.from(
    new Set(
      effectiveItems
        .map((item) => String(item.content.category ?? 'general'))
        .filter(Boolean)
    )
  );
  const orderedCategories = [
    ...TABLE_CATEGORY_ORDER.filter((cat) => encounteredCategories.includes(cat)),
    ...encounteredCategories.filter((cat) => !TABLE_CATEGORY_ORDER.includes(cat)),
  ];

  const groupedItems = hasCategories
    ? orderedCategories
        .map((cat) => ({
          cat,
          label: TABLE_CATEGORY_LABELS[cat] ?? formatCategoryLabel(cat),
          rows: effectiveItems.filter((i) => (i.content.category ?? 'general') === cat),
        }))
        .filter((g) => g.rows.length > 0)
    : [{ cat: '__all__', label: '', rows: effectiveItems }];
  const modelInputs = useMemo(
    () =>
      Object.fromEntries(
        effectiveItems.map((item) => {
          const fieldName = typeof item.content.field_name === 'string' ? item.content.field_name : item.id;
          return [fieldName, {
            field_name: fieldName,
            label: String(item.content.label ?? fieldName),
            value: item.content.value,
            unit: typeof item.content.unit === 'string' ? item.content.unit : null,
            status: typeof item.content.status === 'string' ? item.content.status : null,
          }];
        }),
      ),
    [effectiveItems],
  );

  const handleSave = useCallback(
    async (itemId: string, fieldName: string, value: string) => {
      const item = effectiveItems.find((i) => i.id === itemId);
      if (!item) return;
      const rowFieldType = String(
        item.content?.field_type
        ?? fields.find((f) => f.name === fieldName)?.field_type
        ?? 'text'
      );
      const parsedValue = rowFieldType === 'number'
        ? (value === '' ? null : Number(value))
        : value;
      const hasUserValue = parsedValue !== null && parsedValue !== undefined && String(parsedValue).trim() !== '';
      const nextContent = {
        ...item.content,
        [fieldName]: parsedValue,
        ...(hasUserValue ? { status: 'validated', source: 'user' } : {}),
      };
      setOptimisticContentByItemId((prev) => ({
        ...prev,
        [itemId]: {
          ...(prev[itemId] ?? {}),
          [fieldName]: parsedValue,
          ...(hasUserValue ? { status: 'validated', source: 'user' } : {}),
        },
      }));
      try {
        await api.editStageItem(instanceId, stageId, itemId, nextContent, workflowVersion);
        onChanged();
      } catch (error) {
        setOptimisticContentByItemId((prev) => {
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
        throw error;
      }
    },
    [instanceId, stageId, effectiveItems, fields, onChanged, workflowVersion]
  );

  useEffect(() => {
    if (!proposalModelType || readOnly) return;

    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    const handler = async (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { field_name?: string; value?: unknown; model_type?: string }
        | undefined;
      if (!detail?.field_name || detail.model_type !== proposalModelType || detail.value === undefined) {
        return;
      }

      const fieldName = detail.field_name;
      const row = effectiveItems.find((item) => {
        const content = item.content ?? {};
        const explicitFieldName = typeof content.field_name === 'string' ? content.field_name : '';
        const variable = typeof content.variable === 'string' ? content.variable : '';
        return explicitFieldName === fieldName || normalize(variable) === fieldName;
      });
      if (!row) return;

      const incomingValue = detail.value;
      const currentValue = row.content?.value;
      const isSameValue = String(currentValue ?? '') === String(incomingValue ?? '');
      const isAlreadyConfirmed = row.content?.status === 'validated' || row.content?.status === 'confirmed';
      if (isSameValue && isAlreadyConfirmed) return;

      const nextContent = {
        ...row.content,
        value: incomingValue,
        status: 'validated',
        source: 'user',
      };
      setOptimisticContentByItemId((prev) => ({
        ...prev,
        [row.id]: {
          ...(prev[row.id] ?? {}),
          value: incomingValue,
          status: 'validated',
          source: 'user',
        },
      }));
      try {
        await api.editStageItem(instanceId, stageId, row.id, nextContent, workflowVersion);
        onChanged();
      } catch {
        setOptimisticContentByItemId((prev) => {
          const next = { ...prev };
          delete next[row.id];
          return next;
        });
      }
    };

    window.addEventListener('nitrogen:input-confirmed', handler);
    return () => window.removeEventListener('nitrogen:input-confirmed', handler);
  }, [instanceId, stageId, effectiveItems, onChanged, proposalModelType, readOnly, workflowVersion]);

  const investigate = useCallback(
    (
      label: string,
      status: string,
      fieldName: string,
      currentValue: unknown,
      unit: string,
    ) => {
    const text =
      status === 'inferred'
        ? `Can you investigate the value for ${label} and propose a specific alternative with supporting evidence?`
        : status === 'assumed'
          ? `Can you research and propose a better value for ${label} based on available data for this project?`
          : status === 'validated'
            ? `Can you validate the value for ${label} and propose alternatives if there are better estimates?`
            : `Can you investigate and propose a value for ${label}?`;

      const fieldContext: FieldContext = {
        field_name: fieldName,
        label,
        current_value: typeof currentValue === 'number' ? currentValue : null,
        unit: unit || null,
        model_type: proposalModelType,
        module_id: moduleId,
        status: status || null,
      };

      window.dispatchEvent(new CustomEvent('nitrogen:draft', {
        detail: {
          text,
          label,
          fieldName,
          fieldContext,
          modelInputsContext: buildModelInputsContext('Module', modelInputs, fieldContext),
        },
      }));
    },
    [modelInputs, moduleId, proposalModelType],
  );

  const handleDelete = useCallback(
    async (itemId: string) => {
      setDeleting(itemId);
      try {
        await api.deleteStageItem(instanceId, stageId, itemId, workflowVersion);
        onChanged();
      } finally {
        setDeleting(null);
      }
    },
    [instanceId, stageId, onChanged, workflowVersion]
  );

  const handleAdd = useCallback(
    async (content: Record<string, any>) => {
      await api.addStageItem(instanceId, stageId, content, workflowVersion);
      setAdding(false);
      onChanged();
    },
    [instanceId, stageId, onChanged, workflowVersion]
  );

  const handleSolarLocationChange = useCallback(
    async (lat: number, lon: number, address?: string) => {
      if (!shouldShowSolarLocationMap || interactionsDisabled) return;

      const updates = [
        solarLatRow
          ? {
              row: solarLatRow,
              value: lat,
            }
          : null,
        solarLonRow
          ? {
              row: solarLonRow,
              value: lon,
            }
          : null,
        address !== undefined && solarAddressRow
          ? {
              row: solarAddressRow,
              value: address,
            }
          : null,
      ].filter((update): update is Exclude<typeof update, null> => update !== null);

      if (updates.length === 0) return;

      setIsUpdatingSolarLocation(true);
      setOptimisticContentByItemId((prev) => {
        const next = { ...prev };
        for (const update of updates) {
          next[update.row.id] = {
            ...(prev[update.row.id] ?? {}),
            value: update.value,
            status: 'validated',
            source: 'user',
          };
        }
        return next;
      });

      try {
        let nextWorkflowVersion = workflowVersion;
        for (const update of updates) {
          const response = await api.editStageItem(
            instanceId,
            stageId,
            update.row.id,
            {
              ...update.row.content,
              value: update.value,
              status: 'validated',
              source: 'user',
            },
            nextWorkflowVersion
          );
          nextWorkflowVersion = response.workflow_version;
        }
        onChanged();
      } catch (error) {
        setOptimisticContentByItemId((prev) => {
          const next = { ...prev };
          for (const update of updates) {
            delete next[update.row.id];
          }
          return next;
        });
        throw error;
      } finally {
        setIsUpdatingSolarLocation(false);
      }
    },
    [
      shouldShowSolarLocationMap,
      interactionsDisabled,
      solarLatRow,
      solarLonRow,
      solarAddressRow,
      workflowVersion,
      instanceId,
      stageId,
      onChanged,
    ]
  );

  if (fields.length === 0) {
    return <div className="text-sm text-text-tertiary text-center py-8">No fields configured.</div>;
  }

  if (isLoading && items.length === 0 && !adding) {
    return (
      <div className="py-10">
        <PageLoader label="Loading stage..." />
      </div>
    );
  }

  if (items.length === 0 && !adding && !shouldShowSolarLocationMap) {
    return (
      <div className="text-center py-8 text-sm text-text-tertiary">
        No rows yet.
        {!interactionsDisabled && allowAddRows && (
          <button onClick={() => setAdding(true)} className="ml-2 text-accent hover:underline">
            Add one
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={flush ? 'overflow-hidden' : 'rounded-lg border border-divider overflow-hidden'}>
      {shouldShowSolarLocationMap && (
        <div className="px-4 py-4 border-b border-divider bg-surface-primary">
          <Suspense fallback={<div className="h-[180px] bg-surface-subtle rounded-lg animate-pulse" />}>
            <SolarLocationMap
              lat={solarLat}
              lon={solarLon}
              address={solarAddress}
              onLocationChange={handleSolarLocationChange}
              disabled={interactionsDisabled || isUpdatingSolarLocation}
            />
          </Suspense>
        </div>
      )}

      {groupedItems.map((group) => (
        <div key={group.cat}>
          {group.label && (
            <div className="px-4 py-1.5 bg-surface-subtle border-b border-divider">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                {group.label}
              </span>
            </div>
          )}
          <div>
            {group.rows.map((item) => (
              (() => {
                const rowReadOnly = interactionsDisabled || deleting === item.id;
                const rawFieldName = typeof item.content?.field_name === 'string'
                  ? item.content.field_name
                  : '';
                const variableLabel = String(item.content?.variable ?? '');
                const fieldName = rawFieldName || variableLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                const status = String(item.content?.status ?? '');
                const currentValue = item.content?.value;
                const unit = String(item.content?.unit ?? '');

                return (
                  <TableRow
                    key={item.id}
                    item={item}
                    fields={fields}
                    onSave={(fieldName, value) => handleSave(item.id, fieldName, value)}
                    onDelete={() => handleDelete(item.id)}
                    readOnly={rowReadOnly}
                    investigateEnabled={enableInvestigate && !rowReadOnly}
                    onInvestigateHoverMove={(e, isInteractive) => {
                      setOverInteractive(isInteractive);
                      setMousePos({ x: e.clientX, y: e.clientY });
                      setHoveredInvestigateRow({
                        fieldName,
                        label: variableLabel || fieldName,
                        status,
                      });
                    }}
                    onInvestigateHoverLeave={() => {
                      setHoveredInvestigateRow(null);
                      setOverInteractive(false);
                    }}
                    onInvestigate={() => investigate(variableLabel || fieldName, status, fieldName, currentValue, unit)}
                  />
                );
              })()
            ))}
          </div>
        </div>
      ))}

      {!interactionsDisabled && allowAddRows && adding && (
        <AddRowForm fields={fields} onSubmit={handleAdd} onCancel={() => setAdding(false)} />
      )}

      {!interactionsDisabled && allowAddRows && !adding && (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 w-full px-4 py-2 text-xs text-text-tertiary hover:text-text-secondary transition-colors border-t border-divider/50 hover:bg-surface-subtle/50"
        >
          <Plus className="w-3 h-3" />
          Add row
        </button>
      )}

      {mounted && hoveredInvestigateRow && mousePos && !overInteractive &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[9999] px-2 py-0.5 rounded bg-gray-700 text-white text-[11px] font-medium shadow-md whitespace-nowrap"
            style={{ left: mousePos.x + 16, top: mousePos.y - 32 }}
          >
            Investigate
          </div>,
          document.body
        )}
    </div>
  );
}
