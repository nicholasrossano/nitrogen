import type { ProposedCategory } from '@/lib/api';

type StructureConfirmHandler = (
  initiativeId: string,
  categories: ProposedCategory[],
  deps: {
    confirmPlanCategories: (initiativeId: string, categories: ProposedCategory[]) => Promise<void>;
  },
) => Promise<void>;

const structureConfirmHandlers: Record<string, StructureConfirmHandler> = {
  confirm_project_plan_categories: async (initiativeId, categories, deps) => {
    await deps.confirmPlanCategories(initiativeId, categories);
  },
};

export async function runPlanStructureConfirmAction(
  actionType: string,
  initiativeId: string,
  categories: ProposedCategory[],
  deps: {
    confirmPlanCategories: (initiativeId: string, categories: ProposedCategory[]) => Promise<void>;
  },
): Promise<void> {
  const handler = structureConfirmHandlers[actionType];
  if (!handler) {
    throw new Error(`Unsupported plan structure confirm action: ${actionType}`);
  }
  await handler(initiativeId, categories, deps);
}
