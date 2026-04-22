'use client';

import { useState, useCallback, useEffect } from 'react';
import { Trash2, Plus, GripVertical, Check, X } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { BuildItem, FieldDef } from '@/lib/api';
import { api } from '@/lib/api';
import { getIconByName } from '@/lib/icons';
import { DIAGRAM_ACCENT_COLOR } from '@/lib/diagramAccent';
import { inferCategoryIconName } from './categoryIcons';

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('item not found') || message.includes('http 404');
}

interface Props {
  instanceId: string;
  stageId: string;
  workflowVersion?: number;
  fields: FieldDef[];
  items: BuildItem[];
  readOnly?: boolean;
  onChanged: () => void;
}

// ── Sortable row ──────────────────────────────────────────────────────────

function SortableRow({
  item,
  fields,
  onDelete,
  onEdit,
  readOnly,
}: {
  item: BuildItem;
  fields: FieldDef[];
  onDelete: (id: string) => void;
  onEdit: (id: string, content: Record<string, any>) => void;
  readOnly?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.name, String(item.content[f.name] ?? '')]))
  );

  const primaryField = fields[0];
  const primaryLabel = primaryField ? String(item.content[primaryField.name] ?? '') : 'Item';
  const secondaryField = fields[1];
  const secondaryLabel = secondaryField ? String(item.content[secondaryField.name] ?? '') : null;
  const color = DIAGRAM_ACCENT_COLOR;
  const inferredIcon = inferCategoryIconName(primaryLabel);
  const Icon = getIconByName(String(item.content.icon ?? inferredIcon));

  const handleCommit = () => {
    setEditing(false);
    onEdit(item.id, { ...item.content, ...draft });
  };

  return (
    <div
      ref={setNodeRef}
      className={`border rounded-md px-4 py-3 transition-colors duration-150 ${
        isDragging ? 'opacity-60 bg-surface-subtle' : 'bg-surface'
      }`}
      onMouseEnter={(e) => {
        if (!editing && !isDragging) {
          e.currentTarget.style.backgroundColor = hexToRgba(color, 0.06);
        }
      }}
      onMouseLeave={(e) => {
        if (!isDragging) {
          e.currentTarget.style.backgroundColor = '';
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          e.currentTarget.style.backgroundColor = '';
        }
      }}
      onFocus={(e) => {
        if (!editing && !isDragging) {
          e.currentTarget.style.backgroundColor = hexToRgba(color, 0.06);
        }
      }}
      // Match the real pillar header border treatment.
      style={{ ...style, borderColor: color }}
    >
      <div className={`flex gap-2.5 w-full ${editing || secondaryLabel ? 'items-start' : 'items-center'}`}>
        <div
          className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: hexToRgba(color, 0.1), color }}
        >
          <Icon className="w-5 h-5" />
        </div>

        {editing ? (
          <div className="flex-1 flex flex-col gap-1.5">
            {fields.map((f) => (
              <input
                key={f.name}
                autoFocus={f === fields[0]}
                type={f.field_type === 'number' ? 'number' : 'text'}
                value={draft[f.name]}
                onChange={(e) => setDraft((d) => ({ ...d, [f.name]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCommit();
                  if (e.key === 'Escape') { setDraft(Object.fromEntries(fields.map((fi) => [fi.name, String(item.content[fi.name] ?? '')]))); setEditing(false); }
                }}
                placeholder={f.placeholder ?? f.label ?? f.name}
                className="w-full text-xs bg-surface border border-accent/40 rounded px-2 py-1 outline-none text-text-primary"
              />
            ))}
            <div className="flex gap-1">
              <button onClick={handleCommit} className="p-0.5 text-emerald-600 hover:text-emerald-700 transition-colors">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { setDraft(Object.fromEntries(fields.map((f) => [f.name, String(item.content[f.name] ?? '')]))); setEditing(false); }} className="p-0.5 text-text-tertiary hover:text-text-secondary transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <button
            className="flex-1 text-left min-h-8 flex flex-col justify-center"
            onClick={() => !readOnly && setEditing(true)}
            disabled={readOnly}
          >
            <p className="text-sm font-semibold text-text-primary leading-tight">
              {primaryLabel || <span className="text-text-tertiary italic">Untitled</span>}
            </p>
            {secondaryLabel && (
              <p className="text-xs text-text-secondary mt-1 leading-relaxed line-clamp-2">
                {secondaryLabel}
              </p>
            )}
          </button>
        )}

        <div className="flex items-center gap-1">
          {!readOnly && (
            <button
              {...attributes}
              {...listeners}
              className="text-text-tertiary hover:text-text-secondary cursor-grab active:cursor-grabbing p-0.5"
              aria-label="Reorder"
            >
              <GripVertical className="w-3.5 h-3.5" />
            </button>
          )}
          {!readOnly && !editing && (
            <button
              onClick={() => onDelete(item.id)}
              className="text-text-tertiary hover:text-red-400 transition-colors shrink-0 p-0.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Add-item row ──────────────────────────────────────────────────────────

function AddItemRow({
  fields,
  onSubmit,
  onCancel,
}: {
  fields: FieldDef[];
  onSubmit: (content: Record<string, string>) => Promise<void>;
  onCancel: () => void;
}) {
  const primaryField = fields[0];
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const hasValue = !!value.trim();
  const inferredIcon = inferCategoryIconName(value || primaryField?.label || primaryField?.name || 'Category');
  const Icon = getIconByName(inferredIcon);

  const handleSubmit = async () => {
    if (!primaryField?.name || !value.trim()) return;
    setSaving(true);
    try {
      await onSubmit({ [primaryField.name]: value });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="border border-divider rounded-md px-4 py-3 bg-surface-subtle/40"
    >
      <div className="flex items-center gap-3 w-full min-h-8">
        <div
          className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
          style={{
            backgroundColor: hasValue ? hexToRgba('#6b7280', 0.12) : hexToRgba('#9ca3af', 0.18),
            color: hasValue ? '#6b7280' : '#9ca3af',
          }}
        >
          {hasValue ? (
            <Icon className="w-5 h-5" />
          ) : (
            <span className="w-3.5 h-3.5 rounded-[3px] border-2 border-current/80" />
          )}
        </div>

        <input
          autoFocus
          type={primaryField?.field_type === 'number' ? 'number' : 'text'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') onCancel();
          }}
          placeholder={primaryField?.placeholder ?? primaryField?.label ?? primaryField?.name ?? 'Category'}
          className="flex-1 bg-transparent outline-none text-sm font-semibold text-text-primary placeholder:text-text-tertiary"
        />

        <div className="flex items-center gap-2 pl-1 shrink-0">
        <button onClick={handleSubmit} disabled={saving} className="p-0.5 text-emerald-600 enabled:hover:text-emerald-700 disabled:opacity-40 transition-colors">
          <Check className="w-3.5 h-3.5" />
        </button>
        <button onClick={onCancel} className="p-0.5 text-text-tertiary hover:text-text-secondary transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function CategorizedListStage({ instanceId, stageId, workflowVersion, fields, items, readOnly, onChanged }: Props) {
  const [adding, setAdding] = useState(false);
  const [localItems, setLocalItems] = useState(items);
  const [optimisticAddedItemId, setOptimisticAddedItemId] = useState<string | null>(null);

  // Sync when parent re-fetches (avoid mutating state during render).
  useEffect(() => {
    if (adding) return;
    if (optimisticAddedItemId && !items.some((item) => item.id === optimisticAddedItemId)) return;
    setLocalItems(items);
    if (optimisticAddedItemId && items.some((item) => item.id === optimisticAddedItemId)) {
      setOptimisticAddedItemId(null);
    }
  }, [items, adding, optimisticAddedItemId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIdx = localItems.findIndex((i) => i.id === active.id);
      const newIdx = localItems.findIndex((i) => i.id === over.id);
      const reordered = arrayMove(localItems, oldIdx, newIdx);
      setLocalItems(reordered);
      await api.reorderStageItems(instanceId, stageId, reordered.map((i) => i.id), workflowVersion);
      onChanged();
    },
    [instanceId, stageId, localItems, onChanged, workflowVersion]
  );

  const handleDelete = useCallback(
    async (itemId: string) => {
      const previousItems = localItems;
      setLocalItems((prev) => prev.filter((item) => item.id !== itemId));
      try {
        await api.deleteStageItem(instanceId, stageId, itemId, workflowVersion);
        onChanged();
      } catch (error) {
        // If the backend already deleted it (race/double-click), keep UI state.
        if (isNotFoundError(error)) {
          onChanged();
          return;
        }
        setLocalItems(previousItems);
        throw error;
      }
    },
    [instanceId, stageId, onChanged, localItems, workflowVersion]
  );

  const handleEdit = useCallback(
    async (itemId: string, content: Record<string, any>) => {
      const label = String(content[fields[0]?.name ?? 'label'] ?? '');
      const icon = inferCategoryIconName(label);
      await api.editStageItem(instanceId, stageId, itemId, { ...content, icon }, workflowVersion);
      onChanged();
    },
    [instanceId, stageId, onChanged, fields, workflowVersion]
  );

  const handleAdd = useCallback(
    async (content: Record<string, string>) => {
      const primaryFieldName = fields[0]?.name ?? 'label';
      const icon = inferCategoryIconName(String(content[primaryFieldName] ?? ''));
      const { item } = await api.addStageItem(instanceId, stageId, { ...content, icon }, workflowVersion);
      setLocalItems((prev) => [...prev, item]);
      setOptimisticAddedItemId(item.id);
      setAdding(false);
      onChanged();
    },
    [instanceId, stageId, onChanged, fields, workflowVersion]
  );

  return (
    <div className="flex flex-col gap-2.5">
      {localItems.length === 0 && !adding && (
        <div className="py-8 text-center text-sm text-text-tertiary">
          No items yet.{!readOnly && ' Click + to add one.'}
        </div>
      )}

      {readOnly ? (
        <div className="flex flex-col gap-2.5">
          {localItems.map((item) => (
            <SortableRow
              key={item.id}
              item={item}
              fields={fields}
              onDelete={handleDelete}
              onEdit={handleEdit}
              readOnly
            />
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={localItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2.5">
              {localItems.map((item) => (
                <SortableRow
                  key={item.id}
                  item={item}
                  fields={fields}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {!readOnly && adding && (
        <AddItemRow
          fields={fields}
          onSubmit={handleAdd}
          onCancel={() => setAdding(false)}
        />
      )}

      {!readOnly && !adding && (
        <div className="flex justify-center py-1">
          <button
            onClick={() => setAdding(true)}
            className="w-4 h-4 rounded-full bg-green-500 enabled:hover:bg-green-600 disabled:opacity-40 flex items-center justify-center transition-colors duration-150 shadow-sm"
            aria-label="Add item"
          >
            <Plus className="w-2.5 h-2.5 text-white" strokeWidth={2.5} />
          </button>
        </div>
      )}
    </div>
  );
}
