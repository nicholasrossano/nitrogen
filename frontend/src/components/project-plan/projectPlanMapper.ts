import type {
  DeepDiveResult,
  ProjectPlan,
  ProjectPlanItem,
  ProjectPlanPillar,
} from '@/lib/api';
import type {
  PlanWorkspaceGroup,
  PlanWorkspaceInspectorResult,
  PlanWorkspaceItem,
  PlanWorkspacePhase,
  PlanWorkspaceProgress,
  PlanWorkspaceSummaryData,
} from '@/components/plan-workspace';
import { DIAGRAM_ACCENT_COLOR } from '@/lib/diagramAccent';

function mapPlanItem(item: ProjectPlanItem, pillar: ProjectPlanPillar): PlanWorkspaceItem {
  const fallbackPhaseId =
    item.phase ?? (item.phase_order !== undefined ? `phase_${item.phase_order}` : undefined);

  return {
    id: item.id,
    title: item.title,
    kind: item.item_type ?? 'deliverable',
    classification: item.classification,
    status: item.status,
    rationale: item.rationale,
    groupId: pillar.id,
    groupName: pillar.name,
    phaseId: fallbackPhaseId,
    phaseOrder: item.phase_order,
    userAdded: item.user_added,
    supports: item.supports,
    dependsOn: item.depends_on,
  };
}

export function mapProjectPlanToWorkspaceGroups(plan: ProjectPlan | null): PlanWorkspaceGroup[] {
  if (!plan) return [];
  return plan.pillars.map((pillar) => ({
    id: pillar.id,
    name: pillar.name,
    summary: pillar.summary,
    icon: pillar.icon,
    items: pillar.items.map((item) => mapPlanItem(item, pillar)),
  }));
}

export function mapProjectPlanToWorkspacePhases(plan: ProjectPlan | null): PlanWorkspacePhase[] {
  const explicitPhases = plan?.phases ?? [];
  if (explicitPhases.length > 0) {
    return explicitPhases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      description: phase.description,
    }));
  }

  if (!plan) return [];

  const inferredPhases = new Map<string, { id: string; name: string; order: number }>();
  const inferredFromOrder = new Set<number>();
  plan.pillars.forEach((pillar) => {
    pillar.items.forEach((item) => {
      const order = item.phase_order ?? Number.MAX_SAFE_INTEGER;
      if (!item.phase) {
        if (item.phase_order !== undefined) {
          inferredFromOrder.add(item.phase_order);
        }
        return;
      }
      const existing = inferredPhases.get(item.phase);
      if (!existing || order < existing.order) {
        inferredPhases.set(item.phase, {
          id: item.phase,
          name: item.phase
            .replace(/[_-]+/g, ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase()),
          order,
        });
      }
    });
  });

  const inferredFromIds = Array.from(inferredPhases.values())
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map(({ id, name }) => ({ id, name }));
  if (inferredFromIds.length > 0) {
    return inferredFromIds;
  }

  if (inferredFromOrder.size > 0) {
    return Array.from(inferredFromOrder)
      .sort((a, b) => a - b)
      .map((order) => ({
        id: `phase_${order}`,
        name: `Phase ${order}`,
      }));
  }

  return [];
}

export function mapProjectPlanToProgress(plan: ProjectPlan | null): PlanWorkspaceProgress | null {
  if (!plan) return null;

  const total = plan.pillars.reduce((sum, pillar) => sum + pillar.items.length, 0);
  const completed = plan.pillars.reduce(
    (sum, pillar) => sum + pillar.items.filter((item) => item.status === 'complete').length,
    0,
  );

  return {
    completed,
    total,
    percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    segments: plan.pillars.map((pillar) => ({
      id: pillar.id,
      label: pillar.name,
      color: DIAGRAM_ACCENT_COLOR,
      completed: pillar.items.filter((item) => item.status === 'complete').length,
      total: pillar.items.length,
    })),
  };
}

export function mapDeepDiveToInspectorResult(result: DeepDiveResult | null): PlanWorkspaceInspectorResult | null {
  if (!result) return null;
  return {
    summary: result.what_this_is,
    requirements: result.elements.map((element) => ({
      title: element.title,
      description: element.description,
    })),
    dependencies: result.dependencies,
    documentSources: result.sources
      .filter((source) => source.source_type === 'evidence' && source.evidence_doc_id)
      .map((source) => ({
        title: source.title,
        evidenceDocId: source.evidence_doc_id!,
        chunkId: source.chunk_id ?? null,
      })),
    linkSources: result.sources
      .filter((source) => source.source_type !== 'evidence')
      .map((source) => ({
        title: source.title,
        url: source.url,
        publisher: source.publisher,
      })),
    latencyMs: result.latency_ms,
  };
}

export function buildProjectPlanSummaryData(plan: ProjectPlan): PlanWorkspaceSummaryData {
  const totalItems = plan.pillars.reduce((sum, pillar) => sum + pillar.items.length, 0);
  const requiredCount = plan.pillars.reduce(
    (sum, pillar) => sum + pillar.items.filter((item) => item.classification === 'required').length,
    0,
  );

  return {
    planType: plan.plan_type ?? 'project_plan',
    title: 'Framework',
    footerText: 'You can edit this as needed in the diagram directly.',
    totalItems,
    requiredCount,
    groups: plan.pillars.map((pillar) => ({
      id: pillar.id,
      name: pillar.name,
      itemCount: pillar.items.length,
      requiredCount: pillar.items.filter((item) => item.classification === 'required').length,
      icon: pillar.icon,
    })),
  };
}
