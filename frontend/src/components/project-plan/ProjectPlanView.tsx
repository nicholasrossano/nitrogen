'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessageSquare, LayoutGrid, Clock, ChevronDown, ChevronsUpDown, FileCheck2, Calculator, Plus } from 'lucide-react';
import { api, DeepDiveResult, ProjectPlanItem, ProjectPlanPillar, ProjectPlanPhase } from '@/lib/api';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { PillarColumn } from './PillarColumn';
import { PlanSubItem } from './PlanSubItem';
import { Tooltip } from '@/components/ui/Tooltip';
import { DeepDivePanel } from './DeepDivePanel';
import { SurveyPopup, SurveyConfig, SurveyResponse } from '@/components/survey/SurveyPopup';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';

// Gradient-ordered palette: cool blues → warm reds/browns → greens
const PILLAR_COLORS = [
  '#005e72', // Teal
  '#4a6680', // Slate
  '#8d5e6a', // Dusty rose
  '#7a5030', // Sienna
  '#a06548', // Terracotta
  '#7a6520', // Amber
  '#7a7a3a', // Olive
  '#6b7d6a', // Sage
];

const DELETE_ITEM_SURVEY: SurveyConfig = {
  id: 'project_plan_item_deleted',
  title: 'Why did you remove this item?',
  options: [
    { id: 'not_applicable', label: 'Not applicable to my project' },
    { id: 'already_done', label: 'Already completed' },
    { id: 'duplicate', label: 'Duplicate of another item' },
    { id: 'too_complex', label: 'Skipping for now' },
    { id: 'other', label: 'Other reason' },
  ],
  commentPlaceholder: 'Any additional context? (optional)',
};

const DELETE_ELEMENT_SURVEY: SurveyConfig = {
  id: 'project_plan_element_deleted',
  title: 'Why did you remove this requirement?',
  options: [
    { id: 'not_applicable', label: 'Not applicable to my project' },
    { id: 'already_done', label: 'Already completed' },
    { id: 'duplicate', label: 'Duplicate of another requirement' },
    { id: 'too_complex', label: 'Skipping for now' },
    { id: 'other', label: 'Other reason' },
  ],
  commentPlaceholder: 'Any additional context? (optional)',
};

interface ActiveSurvey {
  config: SurveyConfig;
  contextData: Record<string, unknown>;
}

interface ProjectPlanViewProps {
  initiativeId: string;
  showInspector?: boolean;
  onInspectorChange?: (open: boolean, hasItem: boolean) => void;
  onOpenFullDoc?: (citation: ResearchPanelCitation) => void;
}

interface DeepDiveState {
  item: ProjectPlanItem;
  pillar: ProjectPlanPillar;
  result: DeepDiveResult | null;
  loading: boolean;
  error: string | null;
}

export function ProjectPlanView({ initiativeId, showInspector, onInspectorChange, onOpenFullDoc }: ProjectPlanViewProps) {
  const {
    projectPlan,
    projectPlanLoading,
    error,
    deletePlanItem,
    updatePlanItemStatus,
    addPlanItem,
  } = useInitiativeStore();

  const [deepDive, setDeepDive] = useState<DeepDiveState | null>(null);
  const [localCache, setLocalCache] = useState<Record<string, DeepDiveResult>>({});
  const [activeSurvey, setActiveSurvey] = useState<ActiveSurvey | null>(null);
  const [viewMode, setViewMode] = useState<'category' | 'phase'>('category');
  const [selectedPillarFilter, setSelectedPillarFilter] = useState<string | null>(null);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'deliverable' | 'assessment' | null>(null);
  const [typeFilterDropdownOpen, setTypeFilterDropdownOpen] = useState(false);
  const typeFilterRef = useRef<HTMLDivElement>(null);
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [expandedPillars, setExpandedPillars] = useState<Set<string>>(new Set());
  // Derive completed set directly from persisted plan data
  const completedIds = useMemo<Set<string>>(
    () => new Set(
      (projectPlan?.pillars ?? [])
        .flatMap((p) => p.items)
        .filter((i) => i.status === 'complete')
        .map((i) => i.id)
    ),
    [projectPlan]
  );

  const toggleComplete = useCallback((id: string) => {
    const isComplete = completedIds.has(id);
    updatePlanItemStatus(initiativeId, id, isComplete ? 'not_started' : 'complete');
  }, [completedIds, initiativeId, updatePlanItemStatus]);

  // Column layout strategy:
  // - Ref lives on the OUTER container (grid + panel together) so we always know the total width.
  // - When the panel opens/closes, numCols updates IMMEDIATELY (before the 300ms slide animation)
  //   so cards jump straight to their final column width, then the panel slides in alongside them.
  //   This avoids the "shrink-shrink-snap" artefact where cards continuously narrow then suddenly
  //   reflow after the debounce fires.
  // - Window resize also updates immediately.
  const outerContainerRef = useRef<HTMLDivElement>(null);
  const containerWidth = useRef(0);
  const [numCols, setNumCols] = useState(3);
  const PANEL_WIDTH = 420;
  const computeCols = (w: number) => (w >= 832 ? 3 : w >= 512 ? 2 : 1);

  const panelOpenRef = useRef(false);

  // ── FLIP animation ────────────────────────────────────────────────────────
  // When numCols changes, pillar cards physically slide to their new positions
  // instead of disappearing and reappearing.
  //
  // FIRST  – snapshot each card's current viewport position before the update
  // LAST   – React renders the new column layout (DOM moves the cards)
  // INVERT – useLayoutEffect applies a CSS transform that puts each card back
  //          at its old position (so the user still sees the old layout)
  // PLAY   – remove the transform with a transition, so each card slides to
  //          where the DOM actually placed it
  const pillarCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const flipSnapshot = useRef<Map<string, { x: number; y: number }>>(new Map());

  const registerPillarRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) pillarCardRefs.current.set(id, el);
    else pillarCardRefs.current.delete(id);
  }, []);

  // INVERT + PLAY: runs after every numCols change, before the browser paints
  useLayoutEffect(() => {
    const snapshot = flipSnapshot.current;
    if (snapshot.size === 0) return;

    pillarCardRefs.current.forEach((el, id) => {
      const prev = snapshot.get(id);
      if (!prev) return;
      const curr = el.getBoundingClientRect();
      const dx = Math.round(prev.x - curr.x);
      const dy = Math.round(prev.y - curr.y);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

      // Snap back to old position without transition
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.offsetHeight; // force reflow so the snap is committed

      // Animate to natural (new) position
      el.style.transition = 'transform 320ms cubic-bezier(0.4, 0, 0.2, 1)';
      el.style.transform = '';
      el.addEventListener('transitionend', () => { el.style.transition = ''; }, { once: true });
    });

    flipSnapshot.current = new Map();
  }, [numCols]);

  const transitionNumCols = useCallback((next: number) => {
    // FIRST: snapshot positions before React re-renders
    flipSnapshot.current = new Map();
    pillarCardRefs.current.forEach((el, id) => {
      const r = el.getBoundingClientRect();
      flipSnapshot.current.set(id, { x: r.x, y: r.y });
    });
    setNumCols(next);
  }, []);

  // Track outer container width for window/layout resize events
  useEffect(() => {
    const el = outerContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      containerWidth.current = w;
      transitionNumCols(computeCols(w - (panelOpenRef.current ? PANEL_WIDTH : 0)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [transitionNumCols]);


  // Seed local cache from persisted deep_dives when plan loads
  useEffect(() => {
    if (projectPlan?.deep_dives) {
      setLocalCache((prev) => ({ ...prev, ...projectPlan.deep_dives }));
    }
  }, [projectPlan?.deep_dives]);

  // Merged cache: persisted + local
  const deepDiveCache = useMemo<Record<string, DeepDiveResult>>(() => {
    return { ...(projectPlan?.deep_dives ?? {}), ...localCache };
  }, [projectPlan?.deep_dives, localCache]);

  const runDeepDive = useCallback(
    async (item: ProjectPlanItem, pillar: ProjectPlanPillar) => {
      // User-added items can't be researched — open panel with disclaimer state.
      // Guard on both the flag and the temp-id prefix so the check is robust even
      // if user_added didn't survive serialisation through the backend.
      if (item.user_added || item.id.startsWith('temp-')) {
        setDeepDive({ item, pillar, result: null, loading: false, error: null });
        return;
      }

      const cached = deepDiveCache[item.id];
      if (cached) {
        // Show cached LLM content instantly for immediate UX, but always call the
        // API in the background — the backend strips evidence sources from its DB
        // cache and re-fetches them fresh on every request, so we must hit the API
        // even for previously-run items to get the document citations.
        setDeepDive({ item, pillar, result: cached, loading: false, error: null });
      } else {
        setDeepDive({ item, pillar, result: null, loading: true, error: null });
      }

      try {
        const result = await api.deepDiveItem(initiativeId, item.id, {
          item_title: item.title,
          item_classification: item.classification,
          item_rationale: item.rationale ?? '',
          pillar_name: pillar.name,
        });
        setLocalCache((prev) => ({ ...prev, [item.id]: result }));
        setDeepDive((prev) =>
          prev?.item.id === item.id ? { ...prev, result, loading: false } : prev
        );
      } catch (err) {
        // Only surface the error if there is no cached content to fall back on
        if (!cached) {
          const message =
            err instanceof Error ? err.message : 'Deep dive failed. Please try again.';
          setDeepDive((prev) =>
            prev ? { ...prev, loading: false, error: message } : null
          );
        }
      }
    },
    [initiativeId, deepDiveCache]
  );

  const handleDeepDive = useCallback(
    (item: ProjectPlanItem, pillar: ProjectPlanPillar) => {
      runDeepDive(item, pillar);
      onInspectorChange?.(true, true);
    },
    [runDeepDive, onInspectorChange]
  );

  const handleClosePanel = useCallback(() => {
    if (onInspectorChange) {
      // Parent controls visibility; preserve deepDive for last-item restoration
      onInspectorChange(false, true);
    } else {
      setDeepDive(null);
    }
  }, [onInspectorChange]);

  const handleRetry = useCallback(() => {
    if (deepDive) runDeepDive(deepDive.item, deepDive.pillar);
  }, [deepDive, runDeepDive]);

  const handleDeleteItem = useCallback(
    (itemId: string) => {
      const item = projectPlan?.pillars
        .flatMap((p) => p.items)
        .find((i) => i.id === itemId);

      deletePlanItem(initiativeId, itemId);

      if (deepDive?.item.id === itemId) {
        handleClosePanel();
      }

      setActiveSurvey({
        config: DELETE_ITEM_SURVEY,
        contextData: {
          itemId,
          itemTitle: item?.title ?? '',
          itemClassification: item?.classification ?? '',
          initiativeId,
        },
      });
    },
    [initiativeId, deletePlanItem, deepDive, handleClosePanel, projectPlan]
  );

  const handleSurveySubmit = useCallback((response: SurveyResponse) => {
    // TODO: POST response to /api/v1/survey when backend endpoint is ready
    console.info('[Survey]', response);
    setActiveSurvey(null);
  }, []);

  const handleSurveyDismiss = useCallback(() => {
    setActiveSurvey(null);
  }, []);

  const handleDeleteElement = useCallback(
    (itemId: string, elementIndex: number) => {
      const element = (deepDiveCache[itemId]?.elements ?? [])[elementIndex];
      const parentItem = projectPlan?.pillars
        .flatMap((p) => p.items)
        .find((i) => i.id === itemId);

      setLocalCache((prev) => {
        const cached = prev[itemId] ?? deepDiveCache[itemId];
        if (!cached) return prev;
        return {
          ...prev,
          [itemId]: {
            ...cached,
            elements: cached.elements.filter((_, i) => i !== elementIndex),
          },
        };
      });
      api.deletePlanElement(initiativeId, itemId, elementIndex).catch((err) => {
        console.error('Failed to delete plan element:', err);
      });

      setActiveSurvey({
        config: DELETE_ELEMENT_SURVEY,
        contextData: {
          itemId,
          elementIndex,
          elementTitle: element?.title ?? '',
          parentItemTitle: parentItem?.title ?? '',
          initiativeId,
        },
      });
    },
    [initiativeId, deepDiveCache, projectPlan]
  );

  // Close filter dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target as Node)) {
        setFilterDropdownOpen(false);
      }
    }
    if (filterDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [filterDropdownOpen]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (typeFilterRef.current && !typeFilterRef.current.contains(e.target as Node)) {
        setTypeFilterDropdownOpen(false);
      }
    }
    if (typeFilterDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [typeFilterDropdownOpen]);

  const pillars = useMemo(() => projectPlan?.pillars ?? [], [projectPlan?.pillars]);
  const phases = useMemo(() => projectPlan?.phases ?? [], [projectPlan?.phases]);
  const hasPhases = phases.length > 0 && pillars.some((p) => p.items.some((i) => i.phase));
  const allPhasesCollapsed = phases.length > 0 && collapsedPhases.size >= phases.length;
  const allPillarsExpanded = pillars.length > 0 && expandedPillars.size >= pillars.length;

  // Build phase-grouped items for the phase view
  const phaseGroups = useMemo(() => {
    if (!hasPhases) return [];
    const allItems: { item: ProjectPlanItem; pillar: ProjectPlanPillar }[] = [];
    for (const pillar of pillars) {
      for (const item of pillar.items) {
        allItems.push({ item, pillar });
      }
    }
    return phases.map((phase) => ({
      phase,
      items: allItems
        .filter(({ item, pillar }) =>
          item.phase === phase.id &&
          (!selectedPillarFilter || pillar.id === selectedPillarFilter)
        )
        .sort((a, b) => (a.item.phase_order ?? 999) - (b.item.phase_order ?? 999)),
    }));
  }, [hasPhases, pillars, phases, selectedPillarFilter]);

  const inspectorVisible = showInspector !== undefined ? showInspector : deepDive !== null;
  const panelOpen = !!(inspectorVisible && deepDive);

  // Immediately recalculate numCols when panel opens or closes (must be after panelOpen is declared)
  useEffect(() => {
    panelOpenRef.current = panelOpen;
    const gridW = containerWidth.current - (panelOpen ? PANEL_WIDTH : 0);
    if (gridW > 0) transitionNumCols(computeCols(gridW));
  }, [panelOpen, transitionNumCols]);

  return (
    <div className="h-full flex flex-col bg-surface overflow-hidden">
      {/* Updating indicator (background refresh after initial load) */}
      {projectPlanLoading && projectPlan && (
        <div className="flex items-center justify-center gap-1.5 py-2 flex-shrink-0">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
          <span className="text-xs text-accent">Updating...</span>
        </div>
      )}

      {/* Empty states */}
      {!projectPlan && (
        projectPlanLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <p className="text-sm text-text-secondary">Building your project plan...</p>
            <p className="text-xs text-text-tertiary mt-1">This usually takes 15–30 seconds</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="w-14 h-14 bg-surface-subtle rounded flex items-center justify-center mb-4">
              <MessageSquare className="w-7 h-7 text-text-tertiary" />
            </div>
            <p className="text-sm text-text-secondary mb-1">No project plan yet</p>
            <p className="text-xs text-text-tertiary text-center max-w-xs">
              Describe your project in the chat and confirm the proposed categories to generate your plan.
            </p>
          </div>
        )
      )}

      {/* Main row: pillar grid + deep dive panel side by side */}
      {projectPlan && (() => {
        const totalItems = pillars.reduce((sum, p) => sum + p.items.length, 0);
        const completedCount = pillars.reduce(
          (sum, p) => sum + p.items.filter((i) => completedIds.has(i.id)).length, 0
        );
        const pct = totalItems > 0 ? Math.round((completedCount / totalItems) * 100) : 0;

        return (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Progress tracker */}
          {totalItems > 0 && (
            <div className="flex-shrink-0 px-4 pt-3 pb-2.5 border-b border-divider bg-surface-header">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-text-tertiary">
                  <span className="font-medium text-text-secondary">{completedCount}</span>
                  {' '}of {totalItems} complete
                </span>
                <span className="text-[11px] font-medium text-text-secondary tabular-nums">{pct}%</span>
              </div>
              {/* Single continuous bar — each pillar's completions stack left to right in pillar order */}
              {(() => {
                const lastFilledIdx = pillars.reduce(
                  (last, p, i) => p.items.filter((item) => completedIds.has(item.id)).length > 0 ? i : last, -1
                );
                return (
                  <div className="h-1.5 rounded-full overflow-hidden bg-surface-subtle w-full">
                    <div className="h-full w-full flex">
                      {pillars.map((pillar, pillarIdx) => {
                        const pillarColor = PILLAR_COLORS[pillarIdx % PILLAR_COLORS.length];
                        const pillarDone = pillar.items.filter((i) => completedIds.has(i.id)).length;
                        const widthPct = totalItems > 0 ? (pillarDone / totalItems) * 100 : 0;
                        const isLastFilled = pillarIdx === lastFilledIdx;
                        return (
                          <Tooltip
                            key={pillar.id}
                            content={`${pillar.name}: ${pillarDone} / ${pillar.items.length}`}
                            className="contents"
                          >
                            <div
                              className="h-full transition-[width] duration-300 ease-out flex-shrink-0"
                              style={{
                                width: `${widthPct}%`,
                                backgroundColor: widthPct > 0 ? pillarColor : 'transparent',
                                borderRadius: isLastFilled ? '0 9999px 9999px 0' : undefined,
                                borderRight: widthPct > 0 && !isLastFilled ? '1px solid #F7F5F2' : undefined,
                              }}
                            />
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          <div ref={outerContainerRef} className="flex-1 flex min-h-0 min-w-0 overflow-hidden">
          <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          {/* Toolbar row — view controls */}
          <div className="flex-shrink-0 px-4 pt-4 pb-2 flex items-center justify-end gap-2">

              {/* Expand / Collapse all */}
              <button
                onClick={() => {
                  if (viewMode === 'category') {
                    setExpandedPillars(allPillarsExpanded ? new Set() : new Set(pillars.map((p) => p.id)));
                  } else {
                    setCollapsedPhases(collapsedPhases.size === 0 ? new Set(phases.map((p) => p.id)) : new Set());
                  }
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium text-text-secondary bg-surface-subtle ring-1 ring-inset ring-black/[0.08] hover:bg-black/[0.07] transition-colors whitespace-nowrap"
              >
                {(viewMode === 'category' ? allPillarsExpanded : collapsedPhases.size === 0) ? 'Collapse all' : 'Expand all'}
                <ChevronsUpDown className="w-3 h-3" />
              </button>

              {/* Categories filter */}
              <div ref={filterDropdownRef} className="relative">
                <button
                  onClick={() => setFilterDropdownOpen((v) => !v)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap bg-surface-subtle ring-1 ring-inset hover:bg-black/[0.07] ${
                    selectedPillarFilter
                      ? 'ring-accent/40 text-accent'
                      : 'ring-black/[0.08] text-text-secondary'
                  }`}
                >
                  {selectedPillarFilter
                    ? pillars.find((p) => p.id === selectedPillarFilter)?.name ?? 'Category'
                    : 'All Categories'}
                  <ChevronDown className={`w-2.5 h-2.5 transition-transform duration-150 ${filterDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {filterDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-lg border border-stroke-subtle shadow-md py-1 min-w-[160px]">
                    <button
                      onClick={() => { setSelectedPillarFilter(null); setFilterDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors ${
                        !selectedPillarFilter
                          ? 'text-accent bg-accent/5'
                          : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
                      }`}
                    >
                      All Categories
                    </button>
                    {pillars.map((pillar, idx) => (
                      <button
                        key={pillar.id}
                        onClick={() => { setSelectedPillarFilter(pillar.id); setFilterDropdownOpen(false); }}
                        className={`w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 ${
                          selectedPillarFilter === pillar.id
                            ? 'text-accent bg-accent/5'
                            : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
                        }`}
                      >
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: PILLAR_COLORS[idx % PILLAR_COLORS.length] }}
                        />
                        {pillar.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

          {/* Type filter — always visible */}
          <div ref={typeFilterRef} className="relative">
            <button
              onClick={() => setTypeFilterDropdownOpen((v) => !v)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap bg-surface-subtle ring-1 ring-inset hover:bg-black/[0.07] ${
                selectedTypeFilter
                  ? 'ring-accent/40 text-accent'
                  : 'ring-black/[0.08] text-text-secondary'
              }`}
            >
              {selectedTypeFilter === 'deliverable' && <FileCheck2 className="w-3 h-3" />}
              {selectedTypeFilter === 'assessment' && <Calculator className="w-3 h-3" />}
              {selectedTypeFilter === 'deliverable' ? 'Deliverables' : selectedTypeFilter === 'assessment' ? 'Assessments' : 'All Types'}
              <ChevronDown className={`w-2.5 h-2.5 transition-transform duration-150 ${typeFilterDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {typeFilterDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-lg border border-stroke-subtle shadow-md py-1 min-w-[140px]">
                {([
                  [null, null, 'All Types'],
                  ['deliverable', FileCheck2, 'Deliverables'],
                  ['assessment', Calculator, 'Assessments'],
                ] as const).map(([value, Icon, label]) => (
                  <button
                    key={String(value)}
                    onClick={() => { setSelectedTypeFilter(value); setTypeFilterDropdownOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 ${
                      selectedTypeFilter === value
                        ? 'text-accent bg-accent/5'
                        : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
                    }`}
                  >
                    {Icon && <Icon className="w-3 h-3 flex-shrink-0" />}
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* View mode toggle */}
          {hasPhases && (
            <div className="flex items-center bg-surface-subtle rounded-full p-0.5 w-fit ring-1 ring-inset ring-black/[0.08]">
              {([['category', LayoutGrid, 'Category'], ['phase', Clock, 'Phases']] as const).map(([mode, Icon, label]) => (
                <button
                  key={mode}
                  onClick={() => {
                    setViewMode(mode);
                    if (mode === 'category') setSelectedPillarFilter(null);
                  }}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-150 ${
                    viewMode === mode
                      ? 'bg-white text-text-primary shadow-sm'
                      : 'text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {label}
                </button>
              ))}
            </div>
          )}
          </div>
          {viewMode === 'category' ? (
          <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 p-4 pt-2">
            <div className="flex gap-6 items-start">
              {Array.from({ length: numCols }, (_, colIdx) => (
                <div key={colIdx} className="flex-1 min-w-0 flex flex-col gap-6">
                  {(selectedPillarFilter ? pillars.filter((p) => p.id === selectedPillarFilter) : pillars)
                    .filter((_, i) => i % numCols === colIdx)
                    .map((pillar) => {
                      const globalIdx = pillars.indexOf(pillar);
                      return (
                        <PillarColumn
                          key={pillar.id}
                          pillar={selectedTypeFilter ? { ...pillar, items: pillar.items.filter(i => (i.item_type ?? 'deliverable') === selectedTypeFilter) } : pillar}
                          deepDiveCache={deepDiveCache}
                          onDeepDive={handleDeepDive}
                          onDeleteItem={handleDeleteItem}
                          onDeleteElement={handleDeleteElement}
                          onRegisterRef={(el) => registerPillarRef(pillar.id, el)}
                          completedIds={completedIds}
                          onToggleComplete={toggleComplete}
                          color={PILLAR_COLORS[globalIdx % PILLAR_COLORS.length]}
                          expanded={expandedPillars.has(pillar.id)}
                          onToggleExpanded={() =>
                            setExpandedPillars((prev) => {
                              const next = new Set(prev);
                              if (next.has(pillar.id)) next.delete(pillar.id); else next.add(pillar.id);
                              return next;
                            })
                          }
                          phases={hasPhases ? phases : undefined}
                          onAddItem={(pillarId, title, phaseId) => addPlanItem(initiativeId, pillarId, title, 'deliverable', phaseId)}
                        />
                      );
                    })}
                </div>
              ))}
            </div>
          </div>
          ) : (
          <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 p-4 pt-2">
            <div className="max-w-3xl mx-auto space-y-6">
              {phaseGroups.map((group, groupIdx) => (
                <PhaseSection
                  key={group.phase.id}
                  phase={group.phase}
                  items={selectedTypeFilter ? group.items.filter(({ item }) => (item.item_type ?? 'deliverable') === selectedTypeFilter) : group.items}
                  phaseIndex={groupIdx}
                  totalPhases={phaseGroups.length}
                  pillars={pillars}
                  deepDiveCache={deepDiveCache}
                  onDeepDive={handleDeepDive}
                  onDeleteItem={handleDeleteItem}
                  completedIds={completedIds}
                  onToggleComplete={toggleComplete}
                  collapsed={collapsedPhases.has(group.phase.id)}
                  onToggleCollapsed={(id) =>
                    setCollapsedPhases((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id); else next.add(id);
                      return next;
                    })
                  }
                  onAddItem={(pillarId, title, phaseId) => addPlanItem(initiativeId, pillarId, title, 'deliverable', phaseId)}
                />
              ))}
            </div>
          </div>
          )}
          </div>

          {/* Deep Dive panel — inline, respects header */}
          <div
            className="flex-shrink-0 overflow-hidden"
            style={{ width: inspectorVisible && deepDive ? PANEL_WIDTH : 0 }}
          >
            {deepDive && (
              <DeepDivePanel
                initiativeId={initiativeId}
                item={deepDive.item}
                pillar={deepDive.pillar}
                result={deepDive.result}
                loading={deepDive.loading}
                error={deepDive.error}
                onClose={handleClosePanel}
                onRetry={handleRetry}
                onOpenFullDoc={onOpenFullDoc}
              />
            )}
          </div>
          </div>
        </div>
        );
      })()}

      {activeSurvey && (
        <SurveyPopup
          config={activeSurvey.config}
          contextData={activeSurvey.contextData}
          onSubmit={handleSurveySubmit}
          onDismiss={handleSurveyDismiss}
        />
      )}
    </div>
  );
}


// ── Phase view section ───────────────────────────────────────────────

// Dotted line style shared with PillarColumn
const DOTTED_LINE_STYLE_V = {
  backgroundImage: 'repeating-linear-gradient(to bottom, #C8C4BE 0px, #C8C4BE 3px, transparent 3px, transparent 7px)',
} as const;
const DOTTED_LINE_STYLE_H = {
  backgroundImage: 'repeating-linear-gradient(to right, #C8C4BE 0px, #C8C4BE 3px, transparent 3px, transparent 7px)',
} as const;

interface PhaseSectionProps {
  phase: ProjectPlanPhase;
  items: { item: ProjectPlanItem; pillar: ProjectPlanPillar }[];
  phaseIndex: number;
  totalPhases: number;
  pillars: ProjectPlanPillar[];
  deepDiveCache: Record<string, DeepDiveResult>;
  onDeepDive: (item: ProjectPlanItem, pillar: ProjectPlanPillar) => void;
  onDeleteItem: (itemId: string) => void;
  completedIds: Set<string>;
  onToggleComplete: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: (id: string) => void;
  onAddItem?: (pillarId: string, title: string, phaseId: string) => Promise<void>;
}

function PhaseSection({
  phase,
  items,
  phaseIndex,
  totalPhases,
  pillars,
  deepDiveCache,
  onDeepDive,
  onDeleteItem,
  completedIds,
  onToggleComplete,
  collapsed,
  onToggleCollapsed,
  onAddItem,
}: PhaseSectionProps) {
  const completedInPhase = items.filter(({ item }) => completedIds.has(item.id)).length;

  const [isAdding, setIsAdding] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [selectedPillarId, setSelectedPillarId] = useState(() => pillars[0]?.id ?? '');
  const [addingSaving, setAddingSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleStartAdding = () => {
    setIsAdding(true);
    setNewItemTitle('');
    setSelectedPillarId(pillars[0]?.id ?? '');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleCancelAdding = () => {
    setIsAdding(false);
    setNewItemTitle('');
  };

  const handleCommitItem = async () => {
    const title = newItemTitle.trim();
    if (!title || !onAddItem || addingSaving || !selectedPillarId) return;
    setAddingSaving(true);
    try {
      await onAddItem(selectedPillarId, title, phase.id);
    } finally {
      setAddingSaving(false);
      setIsAdding(false);
      setNewItemTitle('');
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); handleCommitItem(); }
    else if (e.key === 'Escape') { handleCancelAdding(); }
  };

  // Build a color map so pillar badges match the category view
  const pillarColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    pillars.forEach((p, i) => { map[p.id] = PILLAR_COLORS[i % PILLAR_COLORS.length]; });
    return map;
  }, [pillars]);

  return (
    <div>
      {/* Phase header */}
      <button
        onClick={() => onToggleCollapsed(phase.id)}
        className="flex items-center gap-3 w-full text-left mb-2 group"
      >
        {/* Phase number badge */}
        <div className="w-7 h-7 rounded-full bg-accent/10 text-accent flex items-center justify-center text-xs font-bold flex-shrink-0">
          {phaseIndex + 1}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text-primary leading-tight">
            {phase.name}
          </h3>
          {phase.description && (
            <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-1">{phase.description}</p>
          )}
        </div>
        <span className="text-[10px] text-text-tertiary whitespace-nowrap">
          {completedInPhase}/{items.length}
        </span>
      </button>

      {/* Phase items */}
      {!collapsed && (
        <div className="ml-3.5 border-l border-stroke-subtle pl-4 pb-2">
          {/* Single grid so tile column is shared — all tiles same width, badges vary.
              The add-item input lives inside the grid spanning all columns so it
              naturally matches the full row width of [card + badge]. */}
          <div className="grid gap-y-1.5 items-center" style={{ gridTemplateColumns: '1fr auto' }}>
            {items.map(({ item, pillar }) => (
              <React.Fragment key={item.id}>
                <PlanSubItem
                  item={item}
                  isLast={false}
                  onDeepDive={() => onDeepDive(item, pillar)}
                  onDelete={() => onDeleteItem(item.id)}
                  isComplete={completedIds.has(item.id)}
                  onToggleComplete={onToggleComplete}
                  hideBranchGutter
                  fullWidth
                />
                {/* Pillar badge */}
                <span
                  className="text-[9px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap ml-2 self-center justify-self-start"
                  style={{
                    backgroundColor: `${pillarColorMap[pillar.id] ?? '#666'}15`,
                    color: pillarColorMap[pillar.id] ?? '#666',
                  }}
                >
                  {pillar.name}
                </span>
              </React.Fragment>
            ))}

            {/* Input node — inside the grid, spanning all columns to match item row width */}
            {onAddItem && isAdding && (
              <div style={{ gridColumn: '1 / -1' }} className="py-1.5">
                <div className="px-3 py-2 rounded-md shadow-card border border-green-400/50 bg-surface flex flex-col gap-2">
                  <input
                    ref={inputRef}
                    value={newItemTitle}
                    onChange={(e) => setNewItemTitle(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    onBlur={() => { if (!newItemTitle.trim()) handleCancelAdding(); }}
                    placeholder="New item title…"
                    disabled={addingSaving}
                    className="flex-1 text-sm font-medium bg-transparent outline-none text-text-primary placeholder:text-text-tertiary disabled:opacity-50"
                  />
                  {/* Pillar selector */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {pillars.map((p, i) => {
                      const c = PILLAR_COLORS[i % PILLAR_COLORS.length];
                      const selected = selectedPillarId === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); setSelectedPillarId(p.id); }}
                          className={`text-[9px] font-medium px-1.5 py-0.5 rounded transition-all ${selected ? 'ring-1 ring-offset-1 opacity-100' : 'opacity-50 hover:opacity-80'}`}
                          style={{
                            backgroundColor: `${c}20`,
                            color: c,
                            ...(selected ? { outlineColor: c, ringColor: c } : {}),
                          }}
                        >
                          {p.name}
                        </button>
                      );
                    })}
                    {addingSaving && (
                      <div className="w-3 h-3 border-2 border-green-500 border-t-transparent rounded-full animate-spin ml-1" />
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

          {/* Plus button — outside the grid, centered */}
          {onAddItem && !isAdding && (
            <div className="flex justify-center py-2">
              <button
                onClick={handleStartAdding}
                className="w-4 h-4 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center transition-colors duration-150 shadow-sm"
                aria-label="Add item to phase"
              >
                <Plus className="w-2.5 h-2.5 text-white" strokeWidth={2.5} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Connector line between phases */}
      {phaseIndex < totalPhases - 1 && !collapsed && (
        <div className="flex justify-start ml-3.5">
          <div className="w-px h-4 bg-stroke-subtle" />
        </div>
      )}
    </div>
  );
}
