'use client';

/**
 * ImplementationPlanWidget
 *
 * Renders the computed "Plan" stage for the implementation_plan module.
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
import { api } from '@/lib/api';
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
  module_id?: string;
}

interface PlanInspectorSelection {
  item: ImplementationPlanItem;
  group: ImplementationPlanGroup;
}

function sourceLabel(provenance?: ImplementationPlanItem['provenance']): string {
  if (!provenance) return 'Model (training data)';
  const derivation = (provenance.derivation || '').toLowerCase();
  if (derivation.includes('user')) {
    const email = provenance.user_email;
    return email ? `Added by ${email}` : 'Added by user';
  }
  const sources = provenance.sources || [];
  if (sources.length > 0) {
    const cited = sources
      .slice(0, 2)
      .map((source) => source.title || source.url || '')
      .filter(Boolean)
      .join(', ');
    return cited ? `Model (cited: ${cited})` : 'Model';
  }
  return 'Model (training data)';
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

function toInspectorResult(item: ImplementationPlanItem): PlanWorkspaceInspectorResult {
  const summary = item.description?.trim()
    ? [item.description.trim()]
    : ['No additional details provided for this activity yet.'];

  const detailFields = [
    { label: 'Type', value: normalizeItemType(item.item_type) },
    { label: 'Classification', value: normalizeClassification(item.classification) },
    { label: 'Status', value: normalizeStatus(item.status).replace('_', ' ') },
    item.phase ? { label: 'Phase ID', value: item.phase } : null,
    typeof item.phase_order === 'number' ? { label: 'Phase order', value: String(item.phase_order) } : null,
    { label: 'Source', value: sourceLabel(item.provenance) },
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  const supports = (item.supports ?? []).filter(Boolean).map((target) => ({
    title: target,
    description: 'This activity supports this downstream item.',
  }));
  const dependsOn = (item.depends_on ?? []).filter(Boolean).map((dependency) => ({
    condition: dependency,
    effect: 'This activity depends on this prerequisite item.',
  }));

  const linkSources = (item.provenance?.sources ?? []).map((source) => ({
    title: source.title || source.url || 'Source',
    url: source.url ?? null,
    publisher: null,
  }));

  return {
    summary,
    summaryTitle: 'Overview',
    requirements: supports,
    requirementsTitle: 'Supports',
    dependencies: dependsOn,
    dependenciesTitle: 'Depends on',
    detailFields,
    detailFieldsTitle: 'Activity details',
    documentSources: [],
    documentSourcesTitle: 'Project documents',
    linkSources,
    linkSourcesTitle: 'Citations',
    emptySourcesMessage: 'No external citations were attached to this activity.',
    latencyMs: 1,
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
    return {
      item: mapPlanItemToWorkspaceItem(selection.item, selection.group),
      groupName: selection.group.label,
      result: toInspectorResult(selection.item),
      loading: false,
      error: null,
    };
  }, [selection]);

  useEffect(() => {
    onInspectorStateChange?.(inspectorState);
  }, [inspectorState, onInspectorStateChange]);

  const handleOpenItem = useCallback(
    (workspaceItem: PlanWorkspaceItem, workspaceGroup: PlanWorkspaceGroup) => {
      const group = groups.find((candidate) => candidate.id === workspaceGroup.id);
      const item = group?.items.find((candidate) => candidate.id === workspaceItem.id);
      if (!group || !item) return;
      setSelection({ item, group });
      if (!onInspectorStateChange) setLocalInspectorOpen(true);
    },
    [groups, onInspectorStateChange],
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
      module_id: previousWidgetData?.module_id ?? 'implementation_plan',
    };
    setPendingToggleIds((prev) => {
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
    setWidgetData(nextWidgetData);
    try {
      await api.persistModuleWorkflowWidget(
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
  const noopRetryInspector = useCallback(() => {}, []);

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
          onRetryInspector={noopRetryInspector}
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
