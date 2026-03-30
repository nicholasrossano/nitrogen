'use client';

import { useState, useEffect } from 'react';
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
import type { BuildItem } from '@/lib/api';
import { ModuleItem } from '../ModuleItem';
import { coerceDisplayString } from '../renderUtils';

interface Props {
  items: BuildItem[];
  onDelete?: (itemId: string) => void;
  onReorder?: (newItemIds: string[]) => void;
  onAddToChat?: (item: BuildItem) => void;
}

function itemName(item: BuildItem) {
  const c = item.content;
  return (
    coerceDisplayString(c.name ?? c.title) ||
    coerceDisplayString(Object.values(c).find((v) => v != null)) ||
    'Item'
  );
}

function StaticRow({
  item,
  onDelete,
  onAddToChat,
}: Omit<Props, 'items' | 'onReorder'> & { item: BuildItem }) {
  return (
    <ModuleItem
      item={item}
      onDelete={onDelete ? () => onDelete(item.id) : undefined}
      onAddToChat={onAddToChat}
    >
      <p className="text-sm font-medium text-text-primary leading-snug">{itemName(item)}</p>
    </ModuleItem>
  );
}

function SortableRow({
  item,
  onDelete,
  onAddToChat,
}: Omit<Props, 'items' | 'onReorder'> & { item: BuildItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style}>
      <ModuleItem
        item={item}
        onDelete={onDelete ? () => onDelete(item.id) : undefined}
        onAddToChat={onAddToChat}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
      >
        <p className="text-sm font-medium text-text-primary leading-snug">{itemName(item)}</p>
      </ModuleItem>
    </div>
  );
}

function SortableList({
  items: initialItems,
  onDelete,
  onReorder,
  onAddToChat,
}: Props & { onReorder: (newItemIds: string[]) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [localItems, setLocalItems] = useState(initialItems);
  useEffect(() => {
    setLocalItems(initialItems);
  }, [initialItems]);

  if (localItems.length === 0) {
    return <div className="py-8 text-center text-sm text-text-tertiary">No items yet.</div>;
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = localItems.findIndex((i) => i.id === active.id);
    const newIdx = localItems.findIndex((i) => i.id === over.id);
    const reordered = arrayMove(localItems, oldIdx, newIdx);
    setLocalItems(reordered);
    onReorder(reordered.map((i) => i.id));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={localItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-0.5">
          {localItems.map((item) => (
            <SortableRow
              key={item.id}
              item={item}
              onDelete={onDelete}
              onAddToChat={onAddToChat}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export function StructuredListView({ items, onDelete, onReorder, onAddToChat }: Props) {
  if (items.length === 0) {
    return <div className="py-8 text-center text-sm text-text-tertiary">No items yet.</div>;
  }

  if (!onReorder) {
    return (
      <div className="flex flex-col gap-0.5">
        {items.map((item) => (
          <StaticRow
            key={item.id}
            item={item}
            onDelete={onDelete}
            onAddToChat={onAddToChat}
          />
        ))}
      </div>
    );
  }

  return (
    <SortableList
      items={items}
      onDelete={onDelete}
      onReorder={onReorder}
      onAddToChat={onAddToChat}
    />
  );
}
