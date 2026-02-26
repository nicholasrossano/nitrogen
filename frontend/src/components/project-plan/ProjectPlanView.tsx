'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, LayoutGrid } from 'lucide-react';
import { api, DeepDiveResult, ProjectPlanItem, ProjectPlanPillar } from '@/lib/api';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { PillarColumn } from './PillarColumn';
import { DeepDivePanel } from './DeepDivePanel';

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
    loadProjectPlan,
    generateProjectPlan,
  } = useInitiativeStore();

  const hasTriggeredGenerate = useRef(false);
  const [deepDive, setDeepDive] = useState<DeepDiveState | null>(null);
  const [localCache, setLocalCache] = useState<Record<string, DeepDiveResult>>({});

  useEffect(() => {
    loadProjectPlan(initiativeId);
  }, [initiativeId, loadProjectPlan]);

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

  // Auto-generate when opened and no plan exists
  useEffect(() => {
    if (!projectPlanLoading && !projectPlan && !hasTriggeredGenerate.current) {
      hasTriggeredGenerate.current = true;
      generateProjectPlan(initiativeId);
    }
  }, [projectPlan, projectPlanLoading, initiativeId, generateProjectPlan]);

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

  // Loading state during generation
  if (projectPlanLoading && !projectPlan) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 bg-white">
        <Loader2 className="w-6 h-6 animate-spin text-accent mb-3" />
        <p className="text-sm text-text-secondary">Analyzing project...</p>
        <p className="text-xs text-text-tertiary mt-1">
          Building your project needs map
        </p>
      </div>
    );
  }

  // Error state with no plan to show
  if (!projectPlan && error) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 bg-white">
        <div className="w-14 h-14 bg-surface-subtle rounded flex items-center justify-center mb-4">
          <LayoutGrid className="w-7 h-7 text-text-tertiary" />
        </div>
        <p className="text-sm text-text-secondary mb-1">
          Couldn&apos;t generate the project plan
        </p>
        <p className="text-xs text-indicator-orange">{error}</p>
        <button
          onClick={() => generateProjectPlan(initiativeId)}
          className="btn-secondary text-xs mt-4"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!projectPlan) return null;

  const pillars = projectPlan.pillars || [];

  // When showInspector prop is provided, it controls panel visibility.
  // deepDive is preserved as "last viewed item" so it can be restored on reopen.
  const inspectorVisible = showInspector !== undefined ? showInspector : deepDive !== null;

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      {/* Updating indicator */}
      {projectPlanLoading && (
        <div className="flex items-center justify-center gap-1.5 py-2 flex-shrink-0">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
          <span className="text-xs text-accent">Updating...</span>
        </div>
      )}

      {/* Main row: pillar grid + deep dive panel side by side */}
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
              />
            ))}
          </div>
        </div>

        {/* Deep Dive panel — inline, respects header */}
        {inspectorVisible && deepDive && (
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
  );
}
