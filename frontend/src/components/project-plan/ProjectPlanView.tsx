'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import { api, DeepDiveResult, ProjectPlanItem, ProjectPlanPillar } from '@/lib/api';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { PillarColumn } from './PillarColumn';
import { DeepDivePanel } from './DeepDivePanel';
import { SurveyPopup, SurveyConfig, SurveyResponse } from '@/components/survey/SurveyPopup';

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
}

interface DeepDiveState {
  item: ProjectPlanItem;
  pillar: ProjectPlanPillar;
  result: DeepDiveResult | null;
  loading: boolean;
  error: string | null;
}

export function ProjectPlanView({ initiativeId, showInspector, onInspectorChange }: ProjectPlanViewProps) {
  const {
    projectPlan,
    projectPlanLoading,
    error,
    deletePlanItem,
  } = useInitiativeStore();

  const [deepDive, setDeepDive] = useState<DeepDiveState | null>(null);
  const [localCache, setLocalCache] = useState<Record<string, DeepDiveResult>>({});
  const [activeSurvey, setActiveSurvey] = useState<ActiveSurvey | null>(null);

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
      // Return cached result immediately (opens the panel with data)
      const cached = deepDiveCache[item.id];
      if (cached) {
        setDeepDive({ item, pillar, result: cached, loading: false, error: null });
        return;
      }

      setDeepDive({ item, pillar, result: null, loading: true, error: null });
      try {
        const result = await api.deepDiveItem(initiativeId, item.id, {
          item_title: item.title,
          item_classification: item.classification,
          item_rationale: item.rationale ?? '',
          pillar_name: pillar.name,
        });
        setLocalCache((prev) => ({ ...prev, [item.id]: result }));
        setDeepDive((prev) =>
          prev ? { ...prev, result, loading: false } : null
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Deep dive failed. Please try again.';
        setDeepDive((prev) =>
          prev ? { ...prev, loading: false, error: message } : null
        );
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

  const pillars = projectPlan?.pillars ?? [];
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
      {projectPlan && (
        <div ref={outerContainerRef} className="flex-1 flex min-h-0 overflow-hidden">
          {/* Pillar grid — each column is an independent flex stack so expanding one
              pillar never shifts pillars in other columns */}
          <div className="flex-1 overflow-y-auto p-4 pt-5">
            <div className="flex gap-6 items-start">
              {Array.from({ length: numCols }, (_, colIdx) => (
                <div key={colIdx} className="flex-1 flex flex-col gap-6">
                  {pillars
                    .filter((_, i) => i % numCols === colIdx)
                    .map(pillar => (
                      <PillarColumn
                        key={pillar.id}
                        pillar={pillar}
                        deepDiveCache={deepDiveCache}
                        onDeepDive={handleDeepDive}
                        onDeleteItem={handleDeleteItem}
                        onDeleteElement={handleDeleteElement}
                        onRegisterRef={(el) => registerPillarRef(pillar.id, el)}
                      />
                    ))}
                </div>
              ))}
            </div>
          </div>

          {/* Deep Dive panel — inline, respects header */}
          <div
            className="flex-shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out"
            style={{ width: inspectorVisible && deepDive ? 420 : 0 }}
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
              />
            )}
          </div>
        </div>
      )}

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
