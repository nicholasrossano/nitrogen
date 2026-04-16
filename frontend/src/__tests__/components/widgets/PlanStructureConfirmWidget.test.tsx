import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { PlanWorkspaceStructureConfirmData } from '@/components/plan-workspace';
import { PlanStructureConfirmWidget } from '@/components/widgets/PlanStructureConfirmWidget';
import { useInitiativeStore } from '@/stores/initiativeStore';

describe('PlanStructureConfirmWidget', () => {
  beforeEach(() => {
    useInitiativeStore.setState({
      projectPlan: null,
      projectPlanLoading: false,
      confirmPlanCategories: async () => undefined,
    });
  });

  it('runs the configured confirm action through the widget registry', async () => {
    const confirmPlanCategories = jest.fn().mockResolvedValue(undefined);
    useInitiativeStore.setState({
      projectPlan: null,
      projectPlanLoading: false,
      confirmPlanCategories,
    });

    const data: PlanWorkspaceStructureConfirmData = {
      planType: 'project_plan',
      title: 'Proposed Plan Structure',
      subtitle: 'Review and confirm the plan structure.',
      pendingTitle: 'Building your project plan...',
      pendingSubtitleTemplate: 'Generating detailed breakdown for {count} categories',
      successMessage: 'Plan generated.',
      footerHint: 'Remove categories above · Request changes via the chat',
      confirmLabel: 'Confirm & Generate Plan',
      minSelected: 2,
      options: [
        { id: 'authorization', name: 'Authorization', summary: 'Permits', icon: 'Shield' },
        { id: 'capital', name: 'Capital', summary: 'Financing', icon: 'Banknote' },
      ],
      action: { type: 'confirm_project_plan_categories' },
    };

    render(
      <PlanStructureConfirmWidget
        data={data}
        initiativeId="initiative-123"
        isActive
      />,
    );

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Confirm & Generate Plan' }));
    });

    await waitFor(() => {
      expect(confirmPlanCategories).toHaveBeenCalledWith('initiative-123', [
        { id: 'authorization', name: 'Authorization', summary: 'Permits', icon: 'Shield' },
        { id: 'capital', name: 'Capital', summary: 'Financing', icon: 'Banknote' },
      ]);
    });
  });
});
