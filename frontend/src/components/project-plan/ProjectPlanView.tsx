'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  onReady?: () => void;
}

interface DeepDiveState {
  item: ProjectPlanItem;
  pillar: ProjectPlanPillar;
  result: DeepDiveResult | null;
  loading: boolean;
  error: string | null;
}

export function ProjectPlanView({ initiativeId, showInspector, onInspectorChange, onReady }: ProjectPlanViewProps) {
  const {
    projectPlan,
    projectPlanLoading,
    error,
    loadProjectPlan,
    deletePlanItem,
  } = useInitiativeStore();

  const [deepDive, setDeepDive] = useState<DeepDiveState | null>(null);
  const [localCache, setLocalCache] = useState<Record<string, DeepDiveResult>>({});
  const [activeSurvey, setActiveSurvey] = useState<ActiveSurvey | null>(null);

  useEffect(() => {
    loadProjectPlan(initiativeId).finally(() => onReady?.());
  }, [initiativeId, loadProjectPlan, onReady]);

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
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* 3-column pillar tree — squishes when panel is open */}
          <div className="@container flex-1 overflow-y-auto p-4 pt-5">
            <div className="grid grid-cols-1 @[32rem]:grid-cols-2 @[52rem]:grid-cols-3 gap-6">
              {pillars.map(pillar => (
                <PillarColumn
                  key={pillar.id}
                  pillar={pillar}
                  deepDiveCache={deepDiveCache}
                  onDeepDive={handleDeepDive}
                  onDeleteItem={handleDeleteItem}
                  onDeleteElement={handleDeleteElement}
                />
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
