'use client';

import type { PlanWorkspaceStructureConfirmData } from '@/components/plan-workspace';

import { PlanStructureConfirmWidget } from './PlanStructureConfirmWidget';

interface PlanCategoriesWidgetProps {
  data: Record<string, unknown>;
  initiativeId: string;
  isActive?: boolean;
}

export function PlanCategoriesWidget({ data, initiativeId, isActive = true }: PlanCategoriesWidgetProps) {
  const widgetData: PlanWorkspaceStructureConfirmData = {
    planType: 'project_plan',
    title: 'Proposed Plan Structure',
    subtitle: `Proposing the following ${(data?.categories as Array<unknown> | undefined)?.length ?? 0} categories. Review and confirm to generate the full breakdown, or propose changes in the chat.`,
    pendingTitle: 'Building your framework...',
    pendingSubtitleTemplate: 'Generating detailed breakdown for {count} categories',
    successMessage: 'Framework generated. View it in the Framework tab.',
    footerHint: 'Remove categories above · Request changes via the chat',
    confirmLabel: 'Confirm & Generate Plan',
    minSelected: 2,
    options: ((data?.categories as Array<Record<string, unknown>> | undefined) ?? []).map((category) => ({
      id: String(category.id ?? ''),
      name: String(category.name ?? ''),
      summary: String(category.summary ?? ''),
      icon: category.icon ? String(category.icon) : undefined,
    })),
    action: { type: 'confirm_project_plan_categories' },
  };

  return <PlanStructureConfirmWidget data={widgetData} initiativeId={initiativeId} isActive={isActive} />;
}
