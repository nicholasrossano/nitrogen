'use client';

import type { PlanWorkspaceSummaryData } from '@/components/plan-workspace';
import { buildProjectPlanSummaryData } from '@/components/project-plan/projectPlanMapper';

import { PlanSummaryWidget } from './PlanSummaryWidget';

interface ProjectPlanWidgetProps {
  data: Record<string, unknown>;
  projectId: string;
  isActive?: boolean;
}

export function ProjectPlanWidget({ data }: ProjectPlanWidgetProps) {
  const summaryData: PlanWorkspaceSummaryData | null =
    data?.plan && typeof data.plan === 'object'
      ? buildProjectPlanSummaryData(data.plan as any)
      : null;

  if (!summaryData) return null;
  return <PlanSummaryWidget data={summaryData} />;
}
