import { useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, GripVertical, Trash2 } from 'lucide-react';
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
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { UniversalLoadingIcon } from '@/components/ui/PageLoader';
import { getIconByName } from '@/lib/icons';

import { PlanItemNode } from './PlanItemNode';
import type { PlanWorkspaceGroup, PlanWorkspaceItem, PlanWorkspacePhase } from './types';

interface PlanStructureColumnProps {
  group: PlanWorkspaceGroup;
  color: string;
  completedIds?: Set<string>;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  onRegisterRef?: (el: HTMLDivElement | null) => void;
  onOpenItem?: (item: PlanWorkspaceItem, group: PlanWorkspaceGroup) => void;
  onDeleteItem?: (itemId: string) => void;
  onToggleComplete?: (itemId: string) => void;
  phases?: PlanWorkspacePhase[];
  onAddItem?: (groupId: string, title: string, phaseId?: string) => Promise<void>;
  showItemKindBadge?: boolean;
  showItemCompleteToggle?: boolean;
  showItemBranchDelete?: boolean;
  showItemRightActions?: boolean;
  enableItemSorting?: boolean;
  onReorderItems?: (itemIds: string[]) => Promise<void>;
}

const DEFAULT_VISIBLE = 10;

const DOTTED_LINE_STYLE = {
  backgroundImage: 'repeating-linear-gradient(to bottom, #C8C4BE 0px, #C8C4BE 3px, transparent 3px, transparent 7px)',
} as const;

const DOTTED_LINE_H_STYLE = {
  backgroundImage: 'repeating-linear-gradient(to right, #C8C4BE 0px, #C8C4BE 3px, transparent 3px, transparent 7px)',
} as const;

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function PlanStructureColumn({
  group,
  color,
  completedIds,
  expanded: expandedProp,
  onToggleExpanded,
  onRegisterRef,
  onOpenItem,
  onDeleteItem,
  onToggleComplete,
  phases,
  onAddItem,
  showItemKindBadge = true,
  showItemCompleteToggle = true,
  showItemBranchDelete = true,
  showItemRightActions = false,
  enableItemSorting = false,
  onReorderItems,
}: PlanStructureColumnProps) {
  const [showAll, setShowAll] = useState(false);
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const [addingSaving, setAddingSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const itemsExpanded = expandedProp !== undefined ? expandedProp : internalExpanded;
  const toggleExpanded = onToggleExpanded ?? (() => setInternalExpanded((value) => !value));
  const classificationOrder: Record<string, number> = { required: 0, optional: 1, unknown: 2 };
  const items = group.items.slice().sort((a, b) => {
    const aOrder = classificationOrder[a.classification] ?? 1;
    const bOrder = classificationOrder[b.classification] ?? 1;
    return aOrder - bOrder;
  });
  const visibleItems = showAll ? items : items.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = items.length - DEFAULT_VISIBLE;
  const Icon = getIconByName(group.icon);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const renderPlanItem = (item: PlanWorkspaceItem, idx: number) => {
    const itemIsComplete = completedIds?.has(item.id) ?? false;
    return (
    <PlanItemNode
      key={item.id}
      item={item}
      isLast={idx === visibleItems.length - 1 && (showAll || hiddenCount <= 0) && !isAdding}
      onOpen={onOpenItem ? (nextItem) => onOpenItem(nextItem, group) : undefined}
      onDelete={onDeleteItem ? () => onDeleteItem(item.id) : undefined}
      isComplete={itemIsComplete}
      onToggleComplete={onToggleComplete}
      showKindBadge={showItemKindBadge}
      showCompleteToggle={showItemCompleteToggle}
      showBranchDelete={showItemBranchDelete}
      rightActions={showItemRightActions && !itemIsComplete ? (
        <div className="flex items-center gap-1">
          {enableItemSorting && (
            <button
              type="button"
              className="text-text-tertiary hover:text-text-secondary cursor-grab active:cursor-grabbing p-0.5"
              aria-label="Reorder item"
            >
              <GripVertical className="w-3.5 h-3.5" />
            </button>
          )}
          {onDeleteItem && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDeleteItem(item.id);
              }}
              className="text-text-tertiary hover:text-red-400 transition-colors p-0.5"
              aria-label="Delete item"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ) : undefined}
    />
    );
  };

  function SortablePlanItem({ item, idx }: { item: PlanWorkspaceItem; idx: number }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
    const itemIsComplete = completedIds?.has(item.id) ?? false;
    return (
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={isDragging ? 'opacity-60' : undefined}
      >
        <PlanItemNode
          item={item}
          isLast={idx === visibleItems.length - 1 && (showAll || hiddenCount <= 0) && !isAdding}
          onOpen={onOpenItem ? (nextItem) => onOpenItem(nextItem, group) : undefined}
          onDelete={onDeleteItem ? () => onDeleteItem(item.id) : undefined}
          isComplete={itemIsComplete}
          onToggleComplete={onToggleComplete}
          showKindBadge={showItemKindBadge}
          showCompleteToggle={showItemCompleteToggle}
          showBranchDelete={showItemBranchDelete}
          rightActions={showItemRightActions && !itemIsComplete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                {...attributes}
                {...listeners}
                onClick={(e) => e.preventDefault()}
                className="text-text-tertiary hover:text-text-secondary cursor-grab active:cursor-grabbing p-0.5"
                aria-label="Reorder item"
              >
                <GripVertical className="w-3.5 h-3.5" />
              </button>
              {onDeleteItem && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDeleteItem(item.id);
                  }}
                  className="text-text-tertiary hover:text-red-400 transition-colors p-0.5"
                  aria-label="Delete item"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : undefined}
        />
      </div>
    );
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!enableItemSorting || !onReorderItems) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = visibleItems.findIndex((item) => item.id === active.id);
    const newIdx = visibleItems.findIndex((item) => item.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(visibleItems, oldIdx, newIdx);
    await onReorderItems(reordered.map((item) => item.id));
  };

  const handleStartAdding = () => {
    setIsAdding(true);
    setNewItemTitle('');
    setSelectedPhaseId(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleCancelAdding = () => {
    setIsAdding(false);
    setNewItemTitle('');
    setSelectedPhaseId(null);
  };

  const handleCommitItem = async () => {
    const title = newItemTitle.trim();
    if (!title || !onAddItem || addingSaving) return;
    setAddingSaving(true);
    try {
      await onAddItem(group.id, title, selectedPhaseId ?? undefined);
    } finally {
      setAddingSaving(false);
      setIsAdding(false);
      setNewItemTitle('');
      setSelectedPhaseId(null);
    }
  };

  return (
    <div className="flex flex-col min-h-0" ref={(el) => onRegisterRef?.(el)}>
      <button
        onClick={() => toggleExpanded()}
        className="border bg-surface rounded-md px-4 py-3 flex items-center gap-2.5 w-full text-left transition-colors duration-150"
        style={{ borderColor: color }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = hexToRgba(color, 0.06);
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = '';
        }}
      >
        <div
          className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: hexToRgba(color, 0.1), color }}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text-primary leading-tight truncate">
            {group.name}
          </h3>
        </div>
        {itemsExpanded
          ? <ChevronDown className="w-4 h-4 text-text-tertiary flex-shrink-0" />
          : <ChevronRight className="w-4 h-4 text-text-tertiary flex-shrink-0" />}
      </button>

      {itemsExpanded && (
        <div className="flex-1 overflow-y-auto min-h-0">
          {enableItemSorting && onReorderItems ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={visibleItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                {visibleItems.map((item, idx) => (
                  <SortablePlanItem key={item.id} item={item} idx={idx} />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            visibleItems.map((item, idx) => renderPlanItem(item, idx))
          )}

          {!showAll && hiddenCount > 0 && (
            <div className="flex items-stretch">
              <div className="w-8 flex flex-col items-center flex-shrink-0">
                <div className="w-px bg-stroke-subtle flex-1" />
              </div>
              <div className="flex-1 py-1.5 pl-2">
                <button
                  onClick={() => setShowAll(true)}
                  className="text-xs text-text-tertiary hover:text-text-secondary transition-colors flex items-center gap-1"
                >
                  <ChevronDown className="w-3 h-3" />
                  {hiddenCount} more
                </button>
              </div>
            </div>
          )}

          {showAll && hiddenCount > 0 && (
            <div className="flex items-stretch">
              <div className="w-8 flex-shrink-0" />
              <div className="flex-1 py-1.5 pl-2">
                <button
                  onClick={() => setShowAll(false)}
                  className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
                >
                  Show less
                </button>
              </div>
            </div>
          )}

          {onAddItem && (
            isAdding ? (
              <div className="flex items-stretch relative">
                <div className="w-8 flex-shrink-0 relative">
                  <div className="absolute left-1/2 top-0 w-px" style={{ height: '50%', ...DOTTED_LINE_STYLE }} />
                  <div className="absolute top-1/2 left-1/2 right-0 h-px -translate-y-1/2" style={DOTTED_LINE_H_STYLE} />
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-green-500 z-10" />
                </div>
                <div className="flex-1 min-w-0 py-1.5 pr-2">
                  <div className={`px-3 py-2 rounded-md shadow-card border border-green-400/50 bg-surface flex gap-2 ${phases && phases.length > 0 ? 'flex-col' : 'items-center'}`}>
                    <input
                      ref={inputRef}
                      value={newItemTitle}
                      onChange={(e) => setNewItemTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleCommitItem();
                        } else if (e.key === 'Escape') {
                          handleCancelAdding();
                        }
                      }}
                      onBlur={() => {
                        if (!newItemTitle.trim()) handleCancelAdding();
                      }}
                      placeholder="New item title..."
                      disabled={addingSaving}
                      className="flex-1 text-sm font-medium bg-transparent outline-none text-text-primary placeholder:text-text-tertiary disabled:opacity-50"
                    />
                    {phases && phases.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        {phases.map((phase, idx) => {
                          const selected = selectedPhaseId === phase.id;
                          return (
                            <button
                              key={phase.id}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setSelectedPhaseId(selected ? null : phase.id);
                              }}
                              className={`text-[9px] font-medium px-1.5 py-0.5 rounded transition-all ${selected ? 'bg-accent/15 text-accent ring-1 ring-accent/40 ring-offset-1 opacity-100' : 'bg-surface-subtle text-text-tertiary opacity-60 hover:opacity-90'}`}
                            >
                              {idx + 1}. {phase.name}
                            </button>
                          );
                        })}
                        {addingSaving && (
                          <UniversalLoadingIcon
                            size={12}
                            colorClassName="text-green-500"
                            className="ml-1"
                          />
                        )}
                      </div>
                    )}
                    {(!phases || phases.length === 0) && addingSaving && (
                      <UniversalLoadingIcon
                        size={14}
                        colorClassName="text-green-500"
                        className="flex-shrink-0"
                      />
                    )}
                  </div>
                  <p className="text-[10px] text-text-tertiary mt-1 pl-1">Enter to save · Esc to cancel</p>
                </div>
              </div>
            ) : (
              <div className="flex justify-center py-2">
                <button
                  onClick={handleStartAdding}
                  className="w-4 h-4 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center transition-colors duration-150 shadow-sm"
                  aria-label="Add item"
                >
                  <Plus className="w-2.5 h-2.5 text-white" strokeWidth={2.5} />
                </button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
