import type { ProposedCategory } from '@/lib/api';
import { useInitiativeStore } from '@/stores/initiativeStore';

type StructureConfirmHandler = (
  initiativeId: string,
  categories: ProposedCategory[],
  deps: {
    confirmPlanCategories: (initiativeId: string, categories: ProposedCategory[]) => Promise<void>;
  },
) => Promise<void>;

type StructureConfirmRuntime = {
  completed: boolean;
  loading: boolean;
};

type StructureConfirmRegistration = {
  run: StructureConfirmHandler;
  runtime: (state: ReturnType<typeof useInitiativeStore.getState>) => StructureConfirmRuntime;
};

const structureConfirmHandlers: Record<string, StructureConfirmRegistration> = {
  confirm_project_plan_categories: {
    run: async (initiativeId, categories, deps) => {
      await deps.confirmPlanCategories(initiativeId, categories);
    },
    runtime: (state) => ({
      completed: !!state.projectPlan,
      loading: state.projectPlanLoading,
    }),
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
  await handler.run(initiativeId, categories, deps);
}

export function getPlanStructureConfirmRuntime(
  actionType: string,
  state: ReturnType<typeof useInitiativeStore.getState>,
): StructureConfirmRuntime {
  const handler = structureConfirmHandlers[actionType];
  if (!handler) {
    return { completed: false, loading: false };
  }
  return handler.runtime(state);
}
