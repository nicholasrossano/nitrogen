'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import { PlanWorkspaceView } from '@/components/plan-workspace';
import type { PlanWorkspaceInspectorState, PlanWorkspaceItem } from '@/components/plan-workspace';
import { SurveyPopup, SurveyConfig, SurveyResponse } from '@/components/survey/SurveyPopup';
import { api, DeepDiveResult, ProjectPlanItem, ProjectPlanPillar } from '@/lib/api';
import { useInitiativeStore } from '@/stores/initiativeStore';

import {
  buildProjectPlanSummaryData,
  mapDeepDiveToInspectorResult,
  mapProjectPlanToProgress,
  mapProjectPlanToWorkspaceGroups,
  mapProjectPlanToWorkspacePhases,
} from './projectPlanMapper';

const PLAN_COLORS = [
  '#005e72',
  '#4a6680',
  '#8d5e6a',
  '#7a5030',
  '#a06548',
  '#7a6520',
  '#7a7a3a',
  '#6b7d6a',
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

export function ProjectPlanView({
  initiativeId,
  showInspector,
  onInspectorChange,
  onOpenFullDoc,
}: ProjectPlanViewProps) {
  const {
    projectPlan,
    projectPlanLoading,
    deletePlanItem,
    updatePlanItemStatus,
    addPlanItem,
  } = useInitiativeStore();

  const [deepDive, setDeepDive] = useState<DeepDiveState | null>(null);
  const [localCache, setLocalCache] = useState<Record<string, DeepDiveResult>>({});
  const [activeSurvey, setActiveSurvey] = useState<ActiveSurvey | null>(null);

  useEffect(() => {
    if (projectPlan?.deep_dives) {
      setLocalCache((prev) => ({ ...prev, ...projectPlan.deep_dives }));
    }
  }, [projectPlan?.deep_dives]);

  const groups = useMemo(() => mapProjectPlanToWorkspaceGroups(projectPlan), [projectPlan]);
  const phases = useMemo(() => mapProjectPlanToWorkspacePhases(projectPlan), [projectPlan]);
  const progress = useMemo(() => mapProjectPlanToProgress(projectPlan), [projectPlan]);
  const summary = useMemo(
    () => (projectPlan ? buildProjectPlanSummaryData(projectPlan) : null),
    [projectPlan],
  );

  const filterConfig = useMemo(
    () => ({
      id: 'plan-group',
      label: 'Category',
      allLabel: 'All Categories',
      options: groups.map((group, idx) => ({
        id: group.id,
        label: group.name,
        color: PLAN_COLORS[idx % PLAN_COLORS.length],
      })),
    }),
    [groups],
  );

  const deepDiveCache = useMemo<Record<string, DeepDiveResult>>(
    () => ({ ...(projectPlan?.deep_dives ?? {}), ...localCache }),
    [projectPlan?.deep_dives, localCache],
  );

  const toggleComplete = useCallback((id: string) => {
    const item = projectPlan?.pillars.flatMap((pillar) => pillar.items).find((candidate) => candidate.id === id);
    if (!item) return;
    updatePlanItemStatus(initiativeId, id, item.status === 'complete' ? 'not_started' : 'complete');
  }, [initiativeId, projectPlan, updatePlanItemStatus]);

  const runDeepDive = useCallback(async (item: ProjectPlanItem, pillar: ProjectPlanPillar) => {
    if (item.user_added || item.id.startsWith('temp-')) {
      setDeepDive({ item, pillar, result: null, loading: false, error: null });
      return;
    }

    const cached = deepDiveCache[item.id];
    if (cached) {
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
      setDeepDive((prev) => (
        prev?.item.id === item.id ? { ...prev, result, loading: false } : prev
      ));
    } catch (error) {
      if (!cached) {
        const message = error instanceof Error ? error.message : 'Deep dive failed. Please try again.';
        setDeepDive((prev) => (prev ? { ...prev, loading: false, error: message } : null));
      }
    }
  }, [deepDiveCache, initiativeId]);

  const handleOpenItem = useCallback((workspaceItem: PlanWorkspaceItem) => {
    const match = projectPlan?.pillars
      .flatMap((pillar) => pillar.items.map((item) => ({ item, pillar })))
      .find(({ item }) => item.id === workspaceItem.id);
    if (!match) return;
    runDeepDive(match.item, match.pillar);
    onInspectorChange?.(true, true);
  }, [onInspectorChange, projectPlan, runDeepDive]);

  const handleRetry = useCallback(() => {
    if (deepDive) runDeepDive(deepDive.item, deepDive.pillar);
  }, [deepDive, runDeepDive]);

  const handleDeleteItem = useCallback((itemId: string) => {
    const item = projectPlan?.pillars.flatMap((pillar) => pillar.items).find((candidate) => candidate.id === itemId);

    deletePlanItem(initiativeId, itemId);
    if (deepDive?.item.id === itemId) {
      onInspectorChange?.(false, true);
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
  }, [deepDive, deletePlanItem, initiativeId, onInspectorChange, projectPlan]);

  const inspectorState = useMemo<PlanWorkspaceInspectorState | null>(() => {
    if (!deepDive) return null;
    return {
      item: {
        id: deepDive.item.id,
        title: deepDive.item.title,
        kind: deepDive.item.item_type ?? 'deliverable',
        classification: deepDive.item.classification,
        status: deepDive.item.status,
        rationale: deepDive.item.rationale,
        groupId: deepDive.pillar.id,
        groupName: deepDive.pillar.name,
        phaseId: deepDive.item.phase,
        phaseOrder: deepDive.item.phase_order,
        userAdded: deepDive.item.user_added,
        supports: deepDive.item.supports,
        dependsOn: deepDive.item.depends_on,
      },
      groupName: deepDive.result?.pillar_name ?? deepDive.pillar.name,
      result: mapDeepDiveToInspectorResult(deepDive.result),
      loading: deepDive.loading,
      error: deepDive.error,
    };
  }, [deepDive]);

  const handleSurveySubmit = useCallback((response: SurveyResponse) => {
    console.info('[Survey]', response);
    setActiveSurvey(null);
  }, []);

  return (
    <>
      <PlanWorkspaceView
        loading={projectPlanLoading}
        groups={groups}
        phases={phases}
        progress={progress}
        filterConfig={filterConfig}
        inspectorState={inspectorState}
        showInspector={showInspector}
        onInspectorChange={onInspectorChange}
        onOpenItem={handleOpenItem}
        onRetryInspector={handleRetry}
        onDeleteItem={handleDeleteItem}
        onToggleComplete={toggleComplete}
        onAddItem={(groupId, title, phaseId) => addPlanItem(initiativeId, groupId, title, 'deliverable', phaseId)}
        onOpenDocument={(source) => onOpenFullDoc?.({
          evidence_doc_id: source.evidenceDocId,
          chunk_id: source.chunkId ?? null,
          source_title: source.title,
        })}
        emptyState={{
          loadingTitle: 'Building your project plan...',
          loadingSubtitle: 'This usually takes 15–30 seconds',
          emptyTitle: 'No project plan yet',
          emptySubtitle: 'Describe your project in the chat and confirm the proposed categories to generate your plan.',
        }}
        colors={PLAN_COLORS}
      />

      {activeSurvey && (
        <SurveyPopup
          config={activeSurvey.config}
          contextData={activeSurvey.contextData}
          onSubmit={handleSurveySubmit}
          onDismiss={() => setActiveSurvey(null)}
        />
      )}
    </>
  );
}
