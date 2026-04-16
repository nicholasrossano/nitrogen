'use client';

import { useState, useCallback } from 'react';
import { Pencil, Plus, Trash2, Check, X } from 'lucide-react';
import type { BuildItem, FieldDef } from '@/lib/api';
import { api } from '@/lib/api';

interface Props {
  instanceId: string;
  stageId: string;
  fields: FieldDef[];
  items: BuildItem[];
  readOnly?: boolean;
  onChanged: () => void;
}

// ── Inline value editor ──────────────────────────────────────────────────

function ValueEditor({
  value,
  field,
  onSave,
}: {
  value: any;
  field: FieldDef;
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

  if (field.field_type === 'select' && field.options?.length) {
    return (
      <select
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className="text-xs bg-surface border border-accent/40 rounded px-1.5 py-0.5 outline-none text-text-primary font-mono"
      >
        <option value="">—</option>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  return (
    <input
      autoFocus
      type={field.field_type === 'number' ? 'number' : 'text'}
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
}: {
  item: BuildItem;
  fields: FieldDef[];
  onSave: (fieldName: string, value: string) => void;
  onDelete: () => void;
  readOnly?: boolean;
}) {
  const nameField = fields[0];
  const valueField = fields.find((f) => f.field_type === 'number') ?? fields[1];
  const unitField = fields.find((f) => f.name === 'unit');

  const name = String(item.content[nameField?.name ?? 'variable'] ?? '');
  const unit = unitField ? String(item.content[unitField.name] ?? '') : '';
  const status: string = item.content.status ?? (item.origin === 'inferred' ? 'inferred' : '');

  const STATUS_STYLES: Record<string, string> = {
    confirmed: 'bg-green-50 text-green-700',
    inferred: 'bg-blue-50 text-blue-700',
    assumed: 'bg-amber-50 text-amber-700',
    missing: 'bg-red-50 text-red-600',
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-subtle/50 transition-colors group border-b border-stroke-subtle last:border-0">
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
              ? String(item.content[valueField.name])
              : <span className="text-text-tertiary italic">—</span>}
          </span>
        ) : (
          valueField && (
            <ValueEditor
              value={item.content[valueField.name]}
              field={valueField}
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

export function EditableTableStage({ instanceId, stageId, fields, items, readOnly, onChanged }: Props) {
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Group by category if items have a category field in content
  const hasCategories = items.some((item) => item.content.category);
  const categoryOrder = ['project', 'energy', 'costs', 'finance', 'timing', 'general'];
  const CATEGORY_LABELS: Record<string, string> = {
    project: 'Project Definition',
    energy: 'Energy Production',
    costs: 'Costs',
    finance: 'Finance & Discounting',
    timing: 'Timing',
    general: 'General',
  };

  const groupedItems = hasCategories
    ? categoryOrder
        .map((cat) => ({
          cat,
          label: CATEGORY_LABELS[cat] ?? cat,
          rows: items.filter((i) => (i.content.category ?? 'general') === cat),
        }))
        .filter((g) => g.rows.length > 0)
    : [{ cat: '__all__', label: '', rows: items }];

  const handleSave = useCallback(
    async (itemId: string, fieldName: string, value: string) => {
      const item = items.find((i) => i.id === itemId);
      if (!item) return;
      const parsedValue = fields.find((f) => f.name === fieldName)?.field_type === 'number'
        ? (value === '' ? null : Number(value))
        : value;
      await api.editStageItem(instanceId, stageId, itemId, { ...item.content, [fieldName]: parsedValue });
      onChanged();
    },
    [instanceId, stageId, items, fields, onChanged]
  );

  const handleDelete = useCallback(
    async (itemId: string) => {
      setDeleting(itemId);
      try {
        await api.deleteStageItem(instanceId, stageId, itemId);
        onChanged();
      } finally {
        setDeleting(null);
      }
    },
    [instanceId, stageId, onChanged]
  );

  const handleAdd = useCallback(
    async (content: Record<string, any>) => {
      await api.addStageItem(instanceId, stageId, content);
      setAdding(false);
      onChanged();
    },
    [instanceId, stageId, onChanged]
  );

  if (fields.length === 0) {
    return <div className="text-sm text-text-tertiary text-center py-8">No fields configured.</div>;
  }

  if (items.length === 0 && !adding) {
    return (
      <div className="text-center py-8 text-sm text-text-tertiary">
        No rows yet.
        {!readOnly && (
          <button onClick={() => setAdding(true)} className="ml-2 text-accent hover:underline">
            Add one
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-divider overflow-hidden">
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
              <TableRow
                key={item.id}
                item={item}
                fields={fields}
                onSave={(fieldName, value) => handleSave(item.id, fieldName, value)}
                onDelete={() => handleDelete(item.id)}
                readOnly={readOnly || deleting === item.id}
              />
            ))}
          </div>
        </div>
      ))}

      {!readOnly && adding && (
        <AddRowForm fields={fields} onSubmit={handleAdd} onCancel={() => setAdding(false)} />
      )}

      {!readOnly && !adding && (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 w-full px-4 py-2 text-xs text-text-tertiary hover:text-text-secondary transition-colors border-t border-divider/50 hover:bg-surface-subtle/50"
        >
          <Plus className="w-3 h-3" />
          Add row
        </button>
      )}
    </div>
  );
}
