import { useMemo } from 'react';

import type { ProposedCategory } from '@/lib/api';
import { useInitiativeStore } from '@/stores/initiativeStore';
import type { PlanWorkspaceAdapter, PlanWorkspaceStructureOption } from '@/components/plan-workspace';

export function useProjectPlanAdapter(initiativeId: string): PlanWorkspaceAdapter & {
  confirmStructure: (options: PlanWorkspaceStructureOption[]) => Promise<void>;
} {
  const confirmPlanCategories = useInitiativeStore((state) => state.confirmPlanCategories);
  const loadProjectPlan = useInitiativeStore((state) => state.loadProjectPlan);
  const updatePlanItemStatus = useInitiativeStore((state) => state.updatePlanItemStatus);
  const addPlanItem = useInitiativeStore((state) => state.addPlanItem);
  const deletePlanItem = useInitiativeStore((state) => state.deletePlanItem);

  return useMemo(() => ({
    loadStructure: async () => {
      await loadProjectPlan(initiativeId);
    },
    confirmStructure: async (options) => {
      const categories = options.map((option) => ({
        id: option.id,
        name: option.name,
        summary: option.summary,
        icon: option.icon,
      })) satisfies ProposedCategory[];
      await confirmPlanCategories(initiativeId, categories);
    },
    setItemStatus: async (itemId, status) => {
      await updatePlanItemStatus(initiativeId, itemId, status);
    },
    addItem: async (groupId, title, phaseId) => {
      await addPlanItem(initiativeId, groupId, title, 'deliverable', phaseId);
    },
    deleteItem: async (itemId) => {
      await deletePlanItem(initiativeId, itemId);
    },
    loadInspector: async () => null,
    deleteInspectorElement: async () => undefined,
  }), [
    addPlanItem,
    confirmPlanCategories,
    deletePlanItem,
    initiativeId,
    loadProjectPlan,
    updatePlanItemStatus,
  ]);
}
