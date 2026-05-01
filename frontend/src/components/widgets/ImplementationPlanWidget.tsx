'use client';

/**
 * ImplementationPlanWidget
 *
 * Renders the computed "Plan" stage for the implementation_plan assessment.
 * Uses the shared PlanWorkspaceView and inspector behavior.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import {
  PlanWorkspaceView,
  type PlanWorkspaceGroup,
  type PlanWorkspaceInspectorResult,
  type PlanWorkspaceInspectorState,
  type PlanWorkspaceItem,
} from '@/components/plan-workspace';
import { DIAGRAM_ACCENT_COLOR } from '@/lib/diagramAccent';
import { api, type DeepDiveResult } from '@/lib/api';
import type { WorkspaceWidgetProps } from '@/lib/widgetRegistry';

type ImplementationItemType = 'deliverable' | 'assessment';
type ImplementationClassification = 'required' | 'optional' | 'unknown';
type ImplementationStatus = 'not_started' | 'in_progress' | 'complete';

interface ImplementationPlanItem {
  id: string;
  name: string;
  description?: string;
  category: string;
  item_type?: string;
  classification?: string;
  status?: string;
  phase?: string;
  phase_order?: number;
  supports?: string[];
  depends_on?: string[];
  provenance?: {
    derivation?: string;
    sources?: Array<{ title?: string; url?: string }>;
    user_email?: string;
  };
}

interface ImplementationPlanGroup {
  id: string;
  label: string;
  icon?: string;
  color: string;
  items: ImplementationPlanItem[];
}

interface ImplementationPlanData {
  groups: ImplementationPlanGroup[];
  assessment_id?: string;
}

interface PlanInspectorSelection {
  item: ImplementationPlanItem;
  group: ImplementationPlanGroup;
}

function normalizeItemType(value: string | undefined): ImplementationItemType {
  return value === 'assessment' ? 'assessment' : 'deliverable';
}

function normalizeClassification(value: string | undefined): ImplementationClassification {
  if (value === 'required' || value === 'optional' || value === 'unknown') {
    return value;
  }
  return 'unknown';
}

function normalizeStatus(value: string | undefined): ImplementationStatus {
  if (value === 'in_progress' || value === 'complete' || value === 'not_started') {
    return value;
  }
  return 'not_started';
}

interface CachedDeepDiveState {
  result: DeepDiveResult;
}

function mapPlanItemToWorkspaceItem(
  item: ImplementationPlanItem,
  group: ImplementationPlanGroup,
): PlanWorkspaceItem {
  return {
    id: item.id,
    title: item.name,
    kind: normalizeItemType(item.item_type),
    classification: normalizeClassification(item.classification),
    status: normalizeStatus(item.status),
    rationale: item.description,
    groupId: group.id,
    groupName: group.label,
    phaseId: item.phase,
    phaseOrder: item.phase_order,
    supports: item.supports,
    dependsOn: item.depends_on,
  };
}

function toInspectorResult(
  item: ImplementationPlanItem,
  group: ImplementationPlanGroup,
  deepDiveResult: DeepDiveResult | null,
): PlanWorkspaceInspectorResult {
  const fallbackSummary = item.description?.trim()
    ? [item.description.trim()]
    : [`This task belongs to ${group.label}. Open deep dive to generate contextual guidance and sources.`];

  const summary = deepDiveResult?.what_this_is?.length
    ? deepDiveResult.what_this_is
    : fallbackSummary;

  const deepDiveSources = deepDiveResult?.sources ?? [];
  const documentSources = deepDiveSources
    .filter((source) => source.source_type === 'evidence' && source.evidence_doc_id)
    .map((source) => ({
      title: source.title,
      evidenceDocId: source.evidence_doc_id!,
      chunkId: source.chunk_id ?? null,
    }));
  const linkSources = deepDiveSources
    .filter((source) => source.source_type !== 'evidence')
    .map((source) => ({
      title: source.title,
      url: source.url ?? null,
      publisher: source.publisher ?? null,
    }));
  const citationSources = deepDiveSources
    .map((source, idx) => {
      const citationNumber = idx + 1;
      if (source.source_type === 'evidence' && source.evidence_doc_id) {
        return {
          key: `doc:${source.evidence_doc_id}:${source.chunk_id ?? source.title}`,
          label: source.title,
          type: 'document' as const,
          citationNumber,
          title: source.title,
          evidenceDocId: source.evidence_doc_id,
          chunkId: source.chunk_id ?? null,
        };
      }
      return {
        key: `link:${source.title}:${source.url ?? ''}`,
        label: source.title,
        type: 'link' as const,
        citationNumber,
        title: source.title,
        url: source.url ?? null,
        publisher: source.publisher ?? null,
      };
    });

  return {
    summary,
    summaryCitations: deepDiveResult?.summary_citations ?? [],
    summaryTitle: 'What this is',
    requirements: [],
    dependencies: [],
    detailFields: [],
    documentSources,
    linkSources,
    citationSources,
    emptySourcesMessage: deepDiveResult
      ? 'No citations were returned for this deep dive yet.'
      : 'Open deep dive to generate a researched explanation with inline citations.',
    latencyMs: deepDiveResult?.latency_ms ?? 1,
  };
}

export function ImplementationPlanWidget({
  data,
  instanceId,
  workflowVersion,
  onWorkflowUpdated,
  onInspectorStateChange,
}: WorkspaceWidgetProps) {
  const mapData = data as ImplementationPlanData;
  const [widgetData, setWidgetData] = useState<ImplementationPlanData>(mapData);
  const groups = useMemo<ImplementationPlanGroup[]>(
    () => widgetData?.groups ?? [],
    [widgetData],
  );

  const [selection, setSelection] = useState<PlanInspectorSelection | null>(null);
  const [localInspectorOpen, setLocalInspectorOpen] = useState(false);
  const [pendingToggleIds, setPendingToggleIds] = useState<Set<string>>(new Set());
  const [deepDiveCache, setDeepDiveCache] = useState<Record<string, CachedDeepDiveState>>({});
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [inspectorError, setInspectorError] = useState<string | null>(null);

  useEffect(() => {
    setWidgetData(mapData);
  }, [mapData]);

  useEffect(() => {
    if (!selection) return;
    const nextGroup = groups.find((group) => group.id === selection.group.id);
    const nextItem = nextGroup?.items.find((item) => item.id === selection.item.id);
    if (!nextGroup || !nextItem) return;
    if (nextGroup === selection.group && nextItem === selection.item) return;
    setSelection({ group: nextGroup, item: nextItem });
  }, [groups, selection]);

  const workspaceGroups = useMemo<PlanWorkspaceGroup[]>(
    () =>
      groups.map((group) => ({
        id: group.id,
        name: group.label,
        icon: group.icon,
        items: group.items.map((item) => mapPlanItemToWorkspaceItem(item, group)),
      })),
    [groups],
  );

  const filterConfig = useMemo(
    () => ({
      id: 'implementation-category',
      label: 'Category',
      allLabel: 'All Categories',
      options: groups.map((group) => ({
        id: group.id,
        label: group.label,
        color: DIAGRAM_ACCENT_COLOR,
      })),
    }),
    [groups],
  );

  const inspectorState = useMemo<PlanWorkspaceInspectorState | null>(() => {
    if (!selection) return null;
    const cached = deepDiveCache[selection.item.id];
    return {
      item: mapPlanItemToWorkspaceItem(selection.item, selection.group),
      groupName: selection.group.label,
      result: toInspectorResult(selection.item, selection.group, cached?.result ?? null),
      loading: inspectorLoading,
      error: inspectorError,
    };
  }, [deepDiveCache, inspectorError, inspectorLoading, selection]);

  useEffect(() => {
    onInspectorStateChange?.(inspectorState);
  }, [inspectorState, onInspectorStateChange]);

  const handleOpenItem = useCallback(
    (workspaceItem: PlanWorkspaceItem, workspaceGroup: PlanWorkspaceGroup) => {
      const group = groups.find((candidate) => candidate.id === workspaceGroup.id);
      const item = group?.items.find((candidate) => candidate.id === workspaceItem.id);
      if (!group || !item) return;
      setSelection({ item, group });
      setInspectorError(null);
      setInspectorLoading(false);
      if (!onInspectorStateChange) setLocalInspectorOpen(true);
      if (!instanceId) return;
      if (deepDiveCache[item.id]) {
        setInspectorLoading(false);
        return;
      }
      setInspectorLoading(true);
      void api.deepDiveImplementationItem(
        instanceId,
        item.id,
        {
          item_title: item.name,
          item_classification: normalizeClassification(item.classification),
          item_rationale: item.description?.trim() || '',
          pillar_name: group.label,
        },
        workflowVersion,
      ).then((result) => {
        setDeepDiveCache((prev) => ({ ...prev, [item.id]: { result } }));
        setInspectorLoading(false);
      }).catch((error) => {
        setInspectorError(error instanceof Error ? error.message : 'Deep dive failed');
        setInspectorLoading(false);
      });
    },
    [deepDiveCache, groups, instanceId, onInspectorStateChange, workflowVersion],
  );

  const toggleComplete = useCallback(async (itemId: string) => {
    if (!instanceId) return;
    if (pendingToggleIds.has(itemId)) return;
    const previousWidgetData = widgetData;
    let updated = false;
    const nextGroups = groups.map((group) => ({
      ...group,
      items: group.items.map((item) => {
        if (item.id !== itemId) return item;
        const nextStatus = normalizeStatus(item.status) === 'complete' ? 'not_started' : 'complete';
        return { ...item, status: nextStatus };
      }),
    }));
    const nextWidgetData: ImplementationPlanData = {
      ...previousWidgetData,
      groups: nextGroups,
      assessment_id: previousWidgetData?.assessment_id ?? 'implementation_plan',
    };
    setPendingToggleIds((prev) => {
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
    setWidgetData(nextWidgetData);
    try {
      await api.persistAssessmentWorkflowWidget(
        instanceId,
        nextWidgetData,
        workflowVersion,
      );
      updated = true;
    } catch (error) {
      console.error('[ImplementationPlanWidget] Failed to persist toggle', error);
      setWidgetData(previousWidgetData);
    } finally {
      setPendingToggleIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
    if (updated) {
      await onWorkflowUpdated?.();
    }
  }, [groups, instanceId, onWorkflowUpdated, pendingToggleIds, widgetData, workflowVersion]);
  const noopDeleteItem = useCallback((_itemId: string) => {}, []);
  const retryInspector = useCallback(() => {
    if (!selection || !instanceId) return;
    setInspectorError(null);
    setInspectorLoading(true);
    void api.deepDiveImplementationItem(
      instanceId,
      selection.item.id,
      {
        item_title: selection.item.name,
        item_classification: normalizeClassification(selection.item.classification),
        item_rationale: selection.item.description?.trim() || '',
        pillar_name: selection.group.label,
      },
      workflowVersion,
    ).then((result) => {
      setDeepDiveCache((prev) => ({ ...prev, [selection.item.id]: { result } }));
      setInspectorLoading(false);
    }).catch((error) => {
      setInspectorError(error instanceof Error ? error.message : 'Deep dive failed');
      setInspectorLoading(false);
    });
  }, [instanceId, selection, workflowVersion]);

  if (!groups.length) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-text-secondary">
        No implementation data to display yet.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <PlanWorkspaceView
          loading={false}
          groups={workspaceGroups}
          filterConfig={filterConfig}
          displayModes={[{ id: 'group', label: 'Category', icon: LayoutGrid }]}
          inspectorState={onInspectorStateChange ? null : inspectorState}
          showInspector={onInspectorStateChange ? false : localInspectorOpen}
          onInspectorChange={(open, hasItem) => {
            setLocalInspectorOpen(open);
            if (!open && !hasItem) {
              setSelection(null);
            }
          }}
          onOpenItem={handleOpenItem}
          onRetryInspector={retryInspector}
          onDeleteItem={noopDeleteItem}
          onToggleComplete={toggleComplete}
          showItemKindBadge
          showItemCompleteToggle
          showItemBranchDelete={false}
          showItemRightActions={false}
          enableItemSorting={false}
        />
      </div>
    </div>
  );
}

export default ImplementationPlanWidget;
