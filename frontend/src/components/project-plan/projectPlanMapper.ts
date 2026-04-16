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

function mapPlanItem(item: ProjectPlanItem, pillar: ProjectPlanPillar): PlanWorkspaceItem {
  return {
    id: item.id,
    title: item.title,
    kind: item.item_type ?? 'deliverable',
    classification: item.classification,
    status: item.status,
    rationale: item.rationale,
    groupId: pillar.id,
    groupName: pillar.name,
    phaseId: item.phase,
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
  return (plan?.phases ?? []).map((phase) => ({
    id: phase.id,
    name: phase.name,
    description: phase.description,
  }));
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
    segments: plan.pillars.map((pillar, idx) => ({
      id: pillar.id,
      label: pillar.name,
      color: PLAN_COLORS[idx % PLAN_COLORS.length],
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
    title: 'Project Plan',
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
