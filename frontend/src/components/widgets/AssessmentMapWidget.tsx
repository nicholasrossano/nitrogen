'use client';

/**
 * AssessmentMapWidget
 *
 * Renders the "Map" stage for Landscape Mapping and Stakeholder Assessment modules
 * using the shared PlanWorkspaceView and PlanInspectorPanel behavior.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { LayoutGrid } from 'lucide-react';
import {
  PlanWorkspaceView,
  type PlanWorkspaceGroup,
  type PlanWorkspaceInspectorResult,
  type PlanWorkspaceInspectorState,
  type PlanWorkspaceItem,
} from '@/components/plan-workspace';
import { DIAGRAM_ACCENT_COLOR } from '@/lib/diagramAccent';
import type { WorkspaceWidgetProps } from '@/lib/widgetRegistry';
import { api } from '@/lib/api';

interface AssessmentItem {
  id: string;
  name: string;
  description?: string;
  category: string;
  influence_level?: string;
  impact_level?: string;
  engagement_priority?: string;
  role_in_project?: string;
  notes?: string;
  provenance?: {
    derivation?: string;
    sources?: Array<{ title?: string; url?: string }>;
    user_email?: string;
  };
}

interface AssessmentGroup {
  id: string;
  label: string;
  icon?: string;
  color: string;
  items: AssessmentItem[];
}

interface AssessmentMapData {
  groups: AssessmentGroup[];
  module_id?: string;
}

interface CachedDetailState {
  item: AssessmentItem;
  latencyMs: number;
}

interface MapInspectorState {
  itemId: string;
  groupId: string;
  item: AssessmentItem;
  group: AssessmentGroup;
  loading: boolean;
  error: string | null;
  latencyMs: number;
}

interface InspectorFieldSchema<T> {
  label: string;
  getValue: (item: T) => string | null;
}

function sourceLabel(provenance?: AssessmentItem['provenance']): string {
  if (!provenance) return 'Model (training data)';
  const derivation = (provenance.derivation || '').toLowerCase();
  const isUser = derivation.includes('user');
  if (isUser) {
    const email = provenance.user_email;
    return email ? `Added by ${email}` : 'Added by user';
  }
  const sources = provenance.sources || [];
  if (sources.length > 0) {
    const cited = sources
      .slice(0, 2)
      .map((s) => s.title || s.url || '')
      .filter(Boolean)
      .join(', ');
    return cited ? `Model (cited: ${cited})` : 'Model';
  }
  return 'Model (training data)';
}

function formatToken(value: string): string {
  const cleaned = value.replace(/[_-]+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

const STAKEHOLDER_DEEP_DIVE_SCHEMA: InspectorFieldSchema<AssessmentItem>[] = [
  {
    label: 'Role in project',
    getValue: (item) => item.role_in_project?.trim() || null,
  },
  {
    label: 'Influence level',
    getValue: (item) => (item.influence_level ? formatToken(item.influence_level) : null),
  },
  {
    label: 'Impact level',
    getValue: (item) => (item.impact_level ? formatToken(item.impact_level) : null),
  },
  {
    label: 'Engagement priority',
    getValue: (item) => (item.engagement_priority ? formatToken(item.engagement_priority) : null),
  },
  {
    label: 'Notes',
    getValue: (item) => item.notes?.trim() || null,
  },
];

const LANDSCAPE_DEEP_DIVE_SCHEMA: InspectorFieldSchema<AssessmentItem>[] = [
  {
    label: 'Role in project',
    getValue: (item) => item.role_in_project?.trim() || null,
  },
  {
    label: 'Notes',
    getValue: (item) => item.notes?.trim() || null,
  },
];

function mapAssessmentItemToWorkspaceItem(
  item: AssessmentItem,
  group: AssessmentGroup,
): PlanWorkspaceItem {
  return {
    id: item.id,
    title: item.name,
    kind: 'assessment',
    classification: 'unknown',
    status: 'not_started',
    rationale: item.description,
    groupId: group.id,
    groupName: group.label,
  };
}

function toInspectorResult(
  item: AssessmentItem,
  group: AssessmentGroup,
  latencyMs: number,
  isStakeholderModule: boolean,
): PlanWorkspaceInspectorResult {
  const summary: string[] = [];
  if (item.description) summary.push(item.description);
  if (!item.description && item.role_in_project) summary.push(item.role_in_project);

  const schema = isStakeholderModule ? STAKEHOLDER_DEEP_DIVE_SCHEMA : LANDSCAPE_DEEP_DIVE_SCHEMA;
  const detailFields = [
    { label: 'Category', value: group.label },
    ...schema
      .map((field) => {
        const value = field.getValue(item);
        return value ? { label: field.label, value } : null;
      })
      .filter(Boolean),
    { label: 'Derived from', value: sourceLabel(item.provenance) },
  ] as Array<{ label: string; value: string }>;

  const linkSources = (item.provenance?.sources ?? []).map((source) => ({
    title: source.title || source.url || 'Source',
    url: source.url ?? null,
    publisher: null,
  }));

  return {
    summary: summary.length > 0 ? summary : ['This is a mapped item relevant to your project context.'],
    summaryTitle: 'What this is',
    requirements: [],
    dependencies: [],
    detailFields,
    detailFieldsTitle: isStakeholderModule ? 'Stakeholder profile' : 'Item details',
    documentSources: [],
    documentSourcesTitle: 'Project documents',
    linkSources,
    linkSourcesTitle: 'Citations',
    loadingLabel: 'Researching stakeholder details...',
    emptySourcesMessage: isStakeholderModule
      ? 'No external citations are attached to this stakeholder yet.'
      : 'No external citations are attached to this item yet.',
    latencyMs,
  };
}

export function AssessmentMapWidget({
  data,
  instanceId,
  workflowVersion,
  onWorkflowUpdated,
  onInspectorStateChange,
}: WorkspaceWidgetProps) {
  const mapData = data as AssessmentMapData;
  const incomingGroups = useMemo<AssessmentGroup[]>(() => mapData?.groups ?? [], [mapData]);
  const isStakeholderModule = mapData?.module_id === 'stakeholder_assessment';

  const [groups, setGroups] = useState<AssessmentGroup[]>(incomingGroups);
  const [detailCache, setDetailCache] = useState<Record<string, CachedDetailState>>({});
  const [inspector, setInspector] = useState<MapInspectorState | null>(null);
  const [localInspectorOpen, setLocalInspectorOpen] = useState(false);
  const deepDiveRequestRef = useRef(0);

  useEffect(() => {
    setGroups(incomingGroups);
  }, [incomingGroups]);

  useEffect(() => {
    if (!inspector) return;
    const latestGroup = groups.find((group) => group.id === inspector.groupId);
    const latestItem = latestGroup?.items.find((item) => item.id === inspector.itemId);
    if (!latestGroup || !latestItem) return;
    setInspector((prev) => {
      if (!prev || prev.groupId !== latestGroup.id || prev.itemId !== latestItem.id) return prev;
      if (prev.item === latestItem && prev.group === latestGroup) return prev;
      return { ...prev, item: latestItem, group: latestGroup };
    });
  }, [groups, inspector]);

  const hydrateStakeholder = useCallback(async (
    item: AssessmentItem,
    group: AssessmentGroup,
    showLoading: boolean,
  ) => {
    if (!instanceId || !isStakeholderModule) return;
    const requestId = ++deepDiveRequestRef.current;
    const startedAt = Date.now();
    if (showLoading) {
      setInspector((prev) => {
        if (!prev || prev.itemId !== item.id || prev.groupId !== group.id) return prev;
        return { ...prev, loading: true, error: null };
      });
    }
    try {
      const { record } = await api.enrichStakeholderFromMap(instanceId, item.id, workflowVersion);
      const latencyMs = Math.max(1, Date.now() - startedAt);
      const enrichedItem: AssessmentItem = { ...item, ...record };

      setGroups((prev) =>
        prev.map((candidateGroup) => {
          if (candidateGroup.id !== group.id) return candidateGroup;
          return {
            ...candidateGroup,
            items: candidateGroup.items.map((candidateItem) => (
              candidateItem.id === enrichedItem.id ? enrichedItem : candidateItem
            )),
          };
        })
      );
      setDetailCache((prev) => ({ ...prev, [enrichedItem.id]: { item: enrichedItem, latencyMs } }));

      if (requestId === deepDiveRequestRef.current) {
        setInspector((prev) => {
          if (!prev || prev.itemId !== enrichedItem.id || prev.groupId !== group.id) return prev;
          return {
            ...prev,
            item: enrichedItem,
            loading: false,
            error: null,
            latencyMs,
          };
        });
      }

      await onWorkflowUpdated?.();
    } catch (e: any) {
      if (requestId === deepDiveRequestRef.current) {
        setInspector((prev) => {
          if (!prev || prev.itemId !== item.id || prev.groupId !== group.id) return prev;
          return {
            ...prev,
            loading: false,
            error: e.message ?? 'Deep dive failed',
          };
        });
      }
    }
  }, [instanceId, isStakeholderModule, onWorkflowUpdated, workflowVersion]);

  const workspaceGroups = useMemo<PlanWorkspaceGroup[]>(
    () => groups.map((group) => ({
      id: group.id,
      name: group.label,
      icon: group.icon,
      items: group.items.map((item) => mapAssessmentItemToWorkspaceItem(item, group)),
    })),
    [groups],
  );

  const filterConfig = useMemo(
    () => ({
      id: 'assessment-group',
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
    if (!inspector) return null;
    return {
      item: mapAssessmentItemToWorkspaceItem(inspector.item, inspector.group),
      groupName: inspector.group.label,
      result: toInspectorResult(inspector.item, inspector.group, inspector.latencyMs, isStakeholderModule),
      loading: inspector.loading,
      error: inspector.error,
    };
  }, [inspector, isStakeholderModule]);

  useEffect(() => {
    onInspectorStateChange?.(inspectorState);
  }, [inspectorState, onInspectorStateChange]);

  const handleOpenItem = useCallback(
    (workspaceItem: PlanWorkspaceItem, workspaceGroup: PlanWorkspaceGroup) => {
      const group = groups.find((candidate) => candidate.id === workspaceGroup.id);
      const item = group?.items.find((candidate) => candidate.id === workspaceItem.id);
      if (!group || !item) return;
      const cached = detailCache[item.id];

      setInspector({
        itemId: item.id,
        groupId: group.id,
        item: cached?.item ?? item,
        group,
        loading: isStakeholderModule && !cached,
        error: null,
        latencyMs: cached?.latencyMs ?? 1,
      });
      if (!onInspectorStateChange) setLocalInspectorOpen(true);

      if (isStakeholderModule) {
        void hydrateStakeholder(item, group, !cached);
      }
    },
    [detailCache, groups, hydrateStakeholder, isStakeholderModule, onInspectorStateChange],
  );

  const handleRetryInspector = useCallback(() => {
    if (!inspector || !isStakeholderModule) return;
    void hydrateStakeholder(inspector.item, inspector.group, true);
  }, [hydrateStakeholder, inspector, isStakeholderModule]);

  const noopToggleComplete = useCallback((_itemId: string) => {}, []);
  const noopDeleteItem = useCallback((_itemId: string) => {}, []);

  if (!groups.length) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-text-secondary">
        No data to display yet.
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
              setInspector(null);
            }
          }}
          onOpenItem={handleOpenItem}
          onRetryInspector={handleRetryInspector}
          onDeleteItem={noopDeleteItem}
          onToggleComplete={noopToggleComplete}
          showItemKindBadge={false}
          showItemCompleteToggle={false}
          showItemBranchDelete={false}
          showItemRightActions={false}
          enableItemSorting={false}
        />
      </div>
    </div>
  );
}

export default AssessmentMapWidget;
