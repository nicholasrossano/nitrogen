'use client';

import { useState, useCallback } from 'react';
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

interface Props {
  instanceId: string;
  stageId: string;
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

  const handleCommit = () => {
    setEditing(false);
    onEdit(item.id, { ...item.content, ...draft });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-2 py-2.5 rounded-md transition-colors ${
        isDragging ? 'opacity-50 bg-surface-subtle' : 'hover:bg-surface-subtle/60'
      }`}
    >
      {!readOnly && (
        <div
          {...attributes}
          {...listeners}
          className="text-text-tertiary cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
      )}

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
          className="flex-1 text-left"
          onClick={() => !readOnly && setEditing(true)}
          disabled={readOnly}
        >
          <p className="text-sm text-text-primary font-medium leading-snug">{primaryLabel || <span className="text-text-tertiary italic">Untitled</span>}</p>
          {secondaryLabel && <p className="text-xs text-text-secondary mt-0.5 leading-relaxed line-clamp-2">{secondaryLabel}</p>}
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
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.name, '']))
  );
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!values[fields[0]?.name]?.trim()) return;
    setSaving(true);
    try { await onSubmit(values); } finally { setSaving(false); }
  };

  return (
    <div className="px-2 py-2.5 rounded-md bg-accent/5 flex flex-col gap-1.5">
      {fields.map((f) => (
        <input
          key={f.name}
          autoFocus={f === fields[0]}
          type={f.field_type === 'number' ? 'number' : 'text'}
          value={values[f.name]}
          onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') onCancel();
          }}
          placeholder={f.placeholder ?? f.label ?? f.name}
          className="w-full text-xs bg-surface border border-accent/40 rounded px-2 py-1 outline-none text-text-primary"
        />
      ))}
      <div className="flex gap-1">
        <button onClick={handleSubmit} disabled={saving} className="p-0.5 text-emerald-600 enabled:hover:text-emerald-700 disabled:opacity-40 transition-colors">
          <Check className="w-3.5 h-3.5" />
        </button>
        <button onClick={onCancel} className="p-0.5 text-text-tertiary hover:text-text-secondary transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function CategorizedListStage({ instanceId, stageId, fields, items, readOnly, onChanged }: Props) {
  const [adding, setAdding] = useState(false);
  const [localItems, setLocalItems] = useState(items);

  // Sync when parent re-fetches
  if (localItems !== items && !adding) setLocalItems(items);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIdx = localItems.findIndex((i) => i.id === active.id);
      const newIdx = localItems.findIndex((i) => i.id === over.id);
      const reordered = arrayMove(localItems, oldIdx, newIdx);
      setLocalItems(reordered);
      await api.reorderStageItems(instanceId, stageId, reordered.map((i) => i.id));
      onChanged();
    },
    [instanceId, stageId, localItems, onChanged]
  );

  const handleDelete = useCallback(
    async (itemId: string) => {
      await api.deleteStageItem(instanceId, stageId, itemId);
      onChanged();
    },
    [instanceId, stageId, onChanged]
  );

  const handleEdit = useCallback(
    async (itemId: string, content: Record<string, any>) => {
      await api.editStageItem(instanceId, stageId, itemId, content);
      onChanged();
    },
    [instanceId, stageId, onChanged]
  );

  const handleAdd = useCallback(
    async (content: Record<string, string>) => {
      await api.addStageItem(instanceId, stageId, content);
      setAdding(false);
      onChanged();
    },
    [instanceId, stageId, onChanged]
  );

  return (
    <div className="flex flex-col gap-1">
      {localItems.length === 0 && !adding && (
        <div className="py-8 text-center text-sm text-text-tertiary">
          No items yet.{!readOnly && ' Click + to add one.'}
        </div>
      )}

      {readOnly ? (
        <div className="flex flex-col gap-0.5">
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
            <div className="flex flex-col gap-0.5">
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
        <button
          onClick={() => setAdding(true)}
          className="mt-1 flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary transition-colors py-1 px-2"
        >
          <Plus className="w-3.5 h-3.5" />
          Add item
        </button>
      )}
    </div>
  );
}
