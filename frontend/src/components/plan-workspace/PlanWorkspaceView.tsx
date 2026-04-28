'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronsUpDown, Clock, LayoutGrid, MessageSquare, Plus } from 'lucide-react';

import { UniversalLoadingIcon } from '@/components/ui/PageLoader';
import { ReadinessProgressBar } from '@/components/ui/ReadinessProgressBar';

import { PlanInspectorPanel } from './PlanInspectorPanel';
import { PlanItemNode } from './PlanItemNode';
import { PlanStructureColumn } from './PlanStructureColumn';
import type {
  PlanWorkspaceDisplayMode,
  PlanWorkspaceFilterConfig,
  PlanWorkspaceGroup,
  PlanWorkspaceInspectorDocumentSource,
  PlanWorkspaceInspectorState,
  PlanWorkspaceItem,
  PlanWorkspacePhase,
  PlanWorkspaceProgress,
} from './types';
import { DIAGRAM_ACCENT_COLOR } from '@/lib/diagramAccent';

const DEFAULT_COLORS = [DIAGRAM_ACCENT_COLOR];

const DEFAULT_DISPLAY_MODES: PlanWorkspaceDisplayMode[] = [
  { id: 'group', label: 'Category', icon: LayoutGrid },
  { id: 'phase', label: 'Phases', icon: Clock },
];

interface EmptyStateConfig {
  loadingTitle: string;
  loadingSubtitle: string;
  emptyTitle: string;
  emptySubtitle: string;
}

interface PlanWorkspaceViewProps {
  loading: boolean;
  groups: PlanWorkspaceGroup[];
  phases?: PlanWorkspacePhase[];
  progress?: PlanWorkspaceProgress | null;
  filterConfig?: Omit<PlanWorkspaceFilterConfig, 'selectedOptionId'>;
  displayModes?: PlanWorkspaceDisplayMode[];
  inspectorState: PlanWorkspaceInspectorState | null;
  showInspector?: boolean;
  onInspectorChange?: (open: boolean, hasItem: boolean) => void;
  onOpenItem: (item: PlanWorkspaceItem, group: PlanWorkspaceGroup) => void;
  onRetryInspector: () => void;
  onDeleteItem: (itemId: string) => void;
  onToggleComplete: (itemId: string) => void;
  onAddItem?: (groupId: string, title: string, phaseId?: string) => Promise<void>;
  onOpenDocument?: (source: PlanWorkspaceInspectorDocumentSource) => void;
  onViewModeChange?: (modeId: string) => void;
  showItemKindBadge?: boolean;
  showItemCompleteToggle?: boolean;
  showItemBranchDelete?: boolean;
  showItemRightActions?: boolean;
  enableItemSorting?: boolean;
  emptyState?: Partial<EmptyStateConfig>;
  colors?: string[];
}

const DEFAULT_EMPTY_STATE: EmptyStateConfig = {
  loadingTitle: 'Building your plan...',
  loadingSubtitle: 'This usually takes 15–30 seconds',
  emptyTitle: 'No plan yet',
  emptySubtitle: 'Describe your project in the chat and confirm the proposed structure to generate your plan.',
};

export function PlanWorkspaceView({
  loading,
  groups,
  phases = [],
  progress,
  filterConfig,
  displayModes = DEFAULT_DISPLAY_MODES,
  inspectorState,
  showInspector,
  onInspectorChange,
  onOpenItem,
  onRetryInspector,
  onDeleteItem,
  onToggleComplete,
  onAddItem,
  onOpenDocument,
  onViewModeChange,
  showItemKindBadge = true,
  showItemCompleteToggle = true,
  showItemBranchDelete = true,
  showItemRightActions = false,
  enableItemSorting = false,
  emptyState,
  colors = DEFAULT_COLORS,
}: PlanWorkspaceViewProps) {
  const labels = { ...DEFAULT_EMPTY_STATE, ...emptyState };
  const [selectedFilterId, setSelectedFilterId] = useState<string | null>(null);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<string>(displayModes[0]?.id ?? 'group');
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  const completedIds = useMemo(
    () => new Set(
      groups
        .flatMap((group) => group.items)
        .filter((item) => item.status === 'complete')
        .map((item) => item.id),
    ),
    [groups],
  );

  const groupIdsFingerprint = useMemo(
    () => groups.map((group) => group.id).slice().sort().join('\0'),
    [groups],
  );

  useEffect(() => {
    if (!groupIdsFingerprint) return;
    setExpandedGroups(new Set(groupIdsFingerprint.split('\0')));
  }, [groupIdsFingerprint]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
        setFilterDropdownOpen(false);
      }
    };
    if (!filterDropdownOpen) return;
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [filterDropdownOpen]);

  const filteredGroups = useMemo(
    () => (selectedFilterId ? groups.filter((group) => group.id === selectedFilterId) : groups),
    [groups, selectedFilterId],
  );

  const hasPhases = phases.length > 0;
  const visibleDisplayModes = useMemo(
    () => displayModes.filter((mode) => mode.id !== 'phase' || hasPhases),
    [displayModes, hasPhases],
  );

  useEffect(() => {
    if (!visibleDisplayModes.some((mode) => mode.id === viewMode)) {
      setViewMode(visibleDisplayModes[0]?.id ?? 'group');
    }
  }, [visibleDisplayModes, viewMode]);

  const phaseGroups = useMemo(() => {
    if (!hasPhases) return [];
    const allItems = groups.flatMap((group) =>
      group.items.map((item) => ({ item, group })),
    );
    return phases.map((phase) => ({
      phase,
      items: allItems
        .filter(({ item, group }) =>
          item.phaseId === phase.id && (!selectedFilterId || group.id === selectedFilterId),
        )
        .sort((a, b) => (a.item.phaseOrder ?? 999) - (b.item.phaseOrder ?? 999)),
    }));
  }, [groups, hasPhases, phases, selectedFilterId]);

  const inspectorVisible = showInspector !== undefined ? showInspector : inspectorState !== null;
  const panelOpen = Boolean(inspectorVisible && inspectorState);

  const outerContainerRef = useRef<HTMLDivElement>(null);
  const containerWidth = useRef(0);
  const [numCols, setNumCols] = useState(3);
  const panelOpenRef = useRef(false);
  const PANEL_WIDTH = 420;
  const computeCols = (width: number) => (width >= 832 ? 3 : width >= 512 ? 2 : 1);

  const groupCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const flipSnapshot = useRef<Map<string, { x: number; y: number }>>(new Map());

  const registerGroupRef = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) groupCardRefs.current.set(id, element);
    else groupCardRefs.current.delete(id);
  }, []);

  useLayoutEffect(() => {
    const snapshot = flipSnapshot.current;
    if (snapshot.size === 0) return;

    groupCardRefs.current.forEach((element, id) => {
      const previous = snapshot.get(id);
      if (!previous) return;

      const current = element.getBoundingClientRect();
      const dx = Math.round(previous.x - current.x);
      const dy = Math.round(previous.y - current.y);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

      element.style.transition = 'none';
      element.style.transform = `translate(${dx}px, ${dy}px)`;
      element.offsetHeight;
      element.style.transition = 'transform 320ms cubic-bezier(0.4, 0, 0.2, 1)';
      element.style.transform = '';
      element.addEventListener('transitionend', () => {
        element.style.transition = '';
      }, { once: true });
    });

    flipSnapshot.current = new Map();
  }, [numCols]);

  const transitionNumCols = useCallback((next: number) => {
    flipSnapshot.current = new Map();
    groupCardRefs.current.forEach((element, id) => {
      const rect = element.getBoundingClientRect();
      flipSnapshot.current.set(id, { x: rect.x, y: rect.y });
    });
    setNumCols(next);
  }, []);

  useEffect(() => {
    const element = outerContainerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      containerWidth.current = width;
      transitionNumCols(computeCols(width - (panelOpenRef.current ? PANEL_WIDTH : 0)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [transitionNumCols]);

  useEffect(() => {
    panelOpenRef.current = panelOpen;
    const gridWidth = containerWidth.current - (panelOpen ? PANEL_WIDTH : 0);
    if (gridWidth > 0) transitionNumCols(computeCols(gridWidth));
  }, [panelOpen, transitionNumCols]);

  const allPhasesCollapsed = phases.length > 0 && collapsedPhases.size >= phases.length;
  const allGroupsExpanded = groups.length > 0 && expandedGroups.size >= groups.length;

  if (groups.length === 0) {
    return (
      <div className="h-full flex flex-col bg-surface overflow-hidden">
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <p className="text-sm text-text-secondary">{labels.loadingTitle}</p>
            <p className="text-xs text-text-tertiary mt-1">{labels.loadingSubtitle}</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="w-14 h-14 bg-surface-subtle rounded flex items-center justify-center mb-4">
              <MessageSquare className="w-7 h-7 text-text-tertiary" />
            </div>
            <p className="text-sm text-text-secondary mb-1">{labels.emptyTitle}</p>
            <p className="text-xs text-text-tertiary text-center max-w-xs">
              {labels.emptySubtitle}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-surface overflow-hidden">
      {loading && (
        <div className="flex items-center justify-center gap-1.5 py-2 flex-shrink-0">
          <UniversalLoadingIcon size={14} />
          <span className="text-xs text-accent">Updating...</span>
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {progress && progress.total > 0 && (
          <ReadinessProgressBar progress={progress} showSegmentTooltips={true} />
        )}

        <div ref={outerContainerRef} className="flex-1 flex min-h-0 min-w-0 overflow-hidden">
          <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
            <div className="flex-shrink-0 px-4 pt-4 pb-2 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  if (viewMode === 'group') {
                    setExpandedGroups(allGroupsExpanded ? new Set() : new Set(groups.map((group) => group.id)));
                  } else {
                    setCollapsedPhases(allPhasesCollapsed ? new Set() : new Set(phases.map((phase) => phase.id)));
                  }
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium text-text-primary bg-surface ring-1 ring-inset ring-stroke-subtle hover:bg-surface-subtle transition-colors whitespace-nowrap"
              >
                {(viewMode === 'group' ? allGroupsExpanded : !allPhasesCollapsed) ? 'Collapse all' : 'Expand all'}
                <ChevronsUpDown className="w-3 h-3" />
              </button>

              {filterConfig && filterConfig.options.length > 0 && (
                <div ref={filterDropdownRef} className="relative">
                  <button
                    onClick={() => setFilterDropdownOpen((value) => !value)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ring-1 ring-inset hover:bg-surface-subtle ${
                      selectedFilterId
                        ? 'bg-surface-subtle text-text-primary ring-stroke-subtle'
                        : 'bg-surface text-text-primary ring-stroke-subtle'
                    }`}
                  >
                    {selectedFilterId
                      ? filterConfig.options.find((option) => option.id === selectedFilterId)?.label ?? filterConfig.label
                      : filterConfig.allLabel}
                    <ChevronDown className={`w-2.5 h-2.5 transition-transform duration-150 ${filterDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {filterDropdownOpen && (
                    <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-lg border border-stroke-subtle shadow-md py-1 min-w-[160px]">
                      <button
                        onClick={() => {
                          setSelectedFilterId(null);
                          setFilterDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors ${
                          !selectedFilterId
                            ? 'text-accent bg-accent/5'
                            : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
                        }`}
                      >
                        {filterConfig.allLabel}
                      </button>
                      {filterConfig.options.map((option) => (
                        <button
                          key={option.id}
                          onClick={() => {
                            setSelectedFilterId(option.id);
                            setFilterDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 ${
                            selectedFilterId === option.id
                              ? 'text-accent bg-accent/5'
                              : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
                          }`}
                        >
                          {option.color && (
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: option.color }} />
                          )}
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {visibleDisplayModes.length > 1 && (
                <div className="flex items-center bg-surface-subtle rounded-full p-0.5 w-fit ring-1 ring-inset ring-black/[0.08]">
                  {visibleDisplayModes.map((mode) => {
                    const Icon = mode.icon;
                    return (
                      <button
                        key={mode.id}
                        onClick={() => {
                          setViewMode(mode.id);
                          onViewModeChange?.(mode.id);
                          if (mode.id === 'group') setSelectedFilterId(null);
                        }}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-150 ${
                          viewMode === mode.id
                            ? 'bg-white text-text-primary shadow-sm'
                            : 'text-text-tertiary hover:text-text-secondary'
                        }`}
                      >
                        <Icon className="w-3 h-3" />
                        {mode.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {viewMode === 'group' ? (
              <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 p-4 pt-2">
                <div className="flex gap-6 items-start">
                  {Array.from({ length: numCols }, (_, colIdx) => (
                    <div key={colIdx} className="flex-1 min-w-0 flex flex-col gap-6">
                      {filteredGroups
                        .filter((_, idx) => idx % numCols === colIdx)
                        .map((group) => {
                          const globalIdx = groups.findIndex((candidate) => candidate.id === group.id);
                          return (
                            <PlanStructureColumn
                              key={group.id}
                              group={group}
                              color={colors[globalIdx % colors.length]}
                              completedIds={completedIds}
                              expanded={expandedGroups.has(group.id)}
                              onToggleExpanded={() => {
                                setExpandedGroups((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(group.id)) next.delete(group.id);
                                  else next.add(group.id);
                                  return next;
                                });
                              }}
                              onRegisterRef={(element) => registerGroupRef(group.id, element)}
                              onOpenItem={onOpenItem}
                              onDeleteItem={onDeleteItem}
                              onToggleComplete={onToggleComplete}
                              phases={hasPhases ? phases : undefined}
                              onAddItem={onAddItem}
                              showItemKindBadge={showItemKindBadge}
                              showItemCompleteToggle={showItemCompleteToggle}
                              showItemBranchDelete={showItemBranchDelete}
                              showItemRightActions={showItemRightActions}
                              enableItemSorting={enableItemSorting}
                            />
                          );
                        })}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 p-4 pt-2">
                <div className="w-full max-w-none space-y-6">
                  {phaseGroups.map((phaseGroup, idx) => (
                    <PhaseSection
                      key={phaseGroup.phase.id}
                      phase={phaseGroup.phase}
                      items={phaseGroup.items}
                      phaseIndex={idx}
                      totalPhases={phaseGroups.length}
                      groups={groups}
                      colors={colors}
                      completedIds={completedIds}
                      collapsed={collapsedPhases.has(phaseGroup.phase.id)}
                      onToggleCollapsed={(phaseId) => {
                        setCollapsedPhases((prev) => {
                          const next = new Set(prev);
                          if (next.has(phaseId)) next.delete(phaseId);
                          else next.add(phaseId);
                          return next;
                        });
                      }}
                      onOpenItem={onOpenItem}
                      onDeleteItem={onDeleteItem}
                      onToggleComplete={onToggleComplete}
                      onAddItem={onAddItem}
                      showItemKindBadge={showItemKindBadge}
                      showItemCompleteToggle={showItemCompleteToggle}
                      showItemBranchDelete={showItemBranchDelete}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div
            className="flex-shrink-0 overflow-hidden"
            style={{ width: inspectorVisible && inspectorState ? PANEL_WIDTH : 0 }}
          >
            {inspectorState && (
              <PlanInspectorPanel
                state={inspectorState}
                onClose={() => {
                  onInspectorChange?.(false, true);
                }}
                onRetry={onRetryInspector}
                onOpenDocument={onOpenDocument}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface PhaseSectionProps {
  phase: PlanWorkspacePhase;
  items: Array<{ item: PlanWorkspaceItem; group: PlanWorkspaceGroup }>;
  phaseIndex: number;
  totalPhases: number;
  groups: PlanWorkspaceGroup[];
  colors: string[];
  completedIds: Set<string>;
  collapsed: boolean;
  onToggleCollapsed: (phaseId: string) => void;
  onOpenItem: (item: PlanWorkspaceItem, group: PlanWorkspaceGroup) => void;
  onDeleteItem: (itemId: string) => void;
  onToggleComplete: (itemId: string) => void;
  onAddItem?: (groupId: string, title: string, phaseId?: string) => Promise<void>;
  showItemKindBadge: boolean;
  showItemCompleteToggle: boolean;
  showItemBranchDelete: boolean;
}

function PhaseSection({
  phase,
  items,
  phaseIndex,
  totalPhases,
  groups,
  colors,
  completedIds,
  collapsed,
  onToggleCollapsed,
  onOpenItem,
  onDeleteItem,
  onToggleComplete,
  onAddItem,
  showItemKindBadge,
  showItemCompleteToggle,
  showItemBranchDelete,
}: PhaseSectionProps) {
  const completedInPhase = items.filter(({ item }) => completedIds.has(item.id)).length;
  const [isAdding, setIsAdding] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState(() => groups[0]?.id ?? '');
  const [addingSaving, setAddingSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const colorMap = useMemo(() => {
    const next: Record<string, string> = {};
    groups.forEach((group, idx) => {
      next[group.id] = colors[idx % colors.length];
    });
    return next;
  }, [groups, colors]);

  const handleCommitItem = async () => {
    const title = newItemTitle.trim();
    if (!title || !onAddItem || addingSaving || !selectedGroupId) return;
    setAddingSaving(true);
    try {
      await onAddItem(selectedGroupId, title, phase.id);
    } finally {
      setAddingSaving(false);
      setIsAdding(false);
      setNewItemTitle('');
    }
  };

  return (
    <div>
      <button
        onClick={() => onToggleCollapsed(phase.id)}
        className="flex items-center gap-3 w-full text-left mb-2 group"
      >
        <div className="w-7 h-7 rounded-full bg-accent/10 text-accent flex items-center justify-center text-xs font-bold flex-shrink-0">
          {phaseIndex + 1}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text-primary leading-tight">
            {phase.name}
          </h3>
          {phase.description && (
            <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-1">
              {phase.description}
            </p>
          )}
        </div>
        <span className="text-[10px] text-text-tertiary whitespace-nowrap">
          {completedInPhase}/{items.length}
        </span>
      </button>

      {!collapsed && (
        <div className="ml-3.5 border-l border-stroke-subtle pl-4 pb-2">
          <div className="grid gap-y-1.5 items-center" style={{ gridTemplateColumns: '1fr auto' }}>
            {items.map(({ item, group }) => (
              <React.Fragment key={item.id}>
                <PlanItemNode
                  item={item}
                  isLast={false}
                  onOpen={(nextItem) => onOpenItem(nextItem, group)}
                  onDelete={() => onDeleteItem(item.id)}
                  isComplete={completedIds.has(item.id)}
                  onToggleComplete={onToggleComplete}
                  hideBranchGutter
                  fullWidth
                  showKindBadge={showItemKindBadge}
                  showCompleteToggle={showItemCompleteToggle}
                  showBranchDelete={showItemBranchDelete}
                />
                <span
                  className="text-[9px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap ml-2 self-center justify-self-start"
                  style={{
                    backgroundColor: `${colorMap[group.id] ?? '#666'}15`,
                    color: colorMap[group.id] ?? '#666',
                  }}
                >
                  {group.name}
                </span>
              </React.Fragment>
            ))}

            {onAddItem && isAdding && (
              <div style={{ gridColumn: '1 / -1' }} className="py-1.5">
                <div className="px-3 py-2 rounded-md shadow-card border border-green-400/50 bg-surface flex flex-col gap-2">
                  <input
                    ref={inputRef}
                    value={newItemTitle}
                    onChange={(event) => setNewItemTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        handleCommitItem();
                      } else if (event.key === 'Escape') {
                        setIsAdding(false);
                        setNewItemTitle('');
                      }
                    }}
                    onBlur={() => {
                      if (!newItemTitle.trim()) setIsAdding(false);
                    }}
                    placeholder="New item title..."
                    disabled={addingSaving}
                    className="flex-1 text-sm font-medium bg-transparent outline-none text-text-primary placeholder:text-text-tertiary disabled:opacity-50"
                  />
                  <div className="flex items-center gap-1 flex-wrap">
                    {groups.map((group, idx) => {
                      const color = colors[idx % colors.length];
                      const selected = selectedGroupId === group.id;
                      return (
                        <button
                          key={group.id}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setSelectedGroupId(group.id);
                          }}
                          className={`text-[9px] font-medium px-1.5 py-0.5 rounded transition-all ${selected ? 'ring-1 ring-offset-1 opacity-100' : 'opacity-50 hover:opacity-80'}`}
                          style={{
                            backgroundColor: `${color}20`,
                            color,
                          }}
                        >
                          {group.name}
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
                </div>
                <p className="text-[10px] text-text-tertiary mt-1 pl-1">Enter to save · Esc to cancel</p>
              </div>
            )}
          </div>

          {items.length === 0 && !isAdding && (
            <p className="text-xs text-text-tertiary italic py-2">No items in this phase</p>
          )}

          {onAddItem && !isAdding && (
            <div className="flex justify-center py-2">
              <button
                onClick={() => {
                  setIsAdding(true);
                  setNewItemTitle('');
                  setSelectedGroupId(groups[0]?.id ?? '');
                  setTimeout(() => inputRef.current?.focus(), 0);
                }}
                className="w-4 h-4 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center transition-colors duration-150 shadow-sm"
                aria-label="Add item to phase"
              >
                <Plus className="w-2.5 h-2.5 text-white" strokeWidth={2.5} />
              </button>
            </div>
          )}
        </div>
      )}

      {phaseIndex < totalPhases - 1 && !collapsed && (
        <div className="flex justify-start ml-3.5">
          <div className="w-px h-4 bg-stroke-subtle" />
        </div>
      )}
    </div>
  );
}
