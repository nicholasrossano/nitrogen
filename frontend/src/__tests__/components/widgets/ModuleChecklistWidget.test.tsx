import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ModuleChecklistWidget } from '@/components/widgets/ModuleChecklistWidget';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { useSettingsStore } from '@/stores/settingsStore';

const replace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace,
  }),
}));

describe('ModuleChecklistWidget', () => {
  beforeEach(() => {
    replace.mockReset();
    useSettingsStore.setState({ devMode: false });
    useInitiativeStore.setState({
      initiative: { id: 'initiative-123', selected_tools: null } as any,
      projectPlan: null,
      error: null,
      selectTools: async () => undefined,
      generateProjectPlan: async () => undefined,
    });
  });

  it('groups recommended modules by framework category and confirms the selection', async () => {
    const selectTools = jest.fn().mockImplementation(async () => {
      useInitiativeStore.setState({
        error: null,
        initiative: {
          id: 'initiative-123',
          selected_tools: ['landscape_mapping'],
        } as any,
      });
    });

    useInitiativeStore.setState({
      initiative: { id: 'initiative-123', selected_tools: null } as any,
      projectPlan: null,
      error: null,
      selectTools,
    });

    render(
      <ModuleChecklistWidget
        initiativeId="initiative-123"
        isActive
        data={{
          title: 'Recommended Framework Modules',
          recommendations: [
            {
              tool: {
                id: 'landscape_mapping',
                name: 'Landscape Mapping',
                description: 'Map the ecosystem of actors and initiatives',
                icon: 'Map',
                output_type: 'analysis',
                category: 'opportunity',
              },
              confidence: 0.92,
              recommended: true,
            },
            {
              tool: {
                id: 'lcoe_model',
                name: 'LCOE Model',
                description: 'Calculate levelized cost of energy',
                icon: 'Calculator',
                output_type: 'analysis',
                category: 'feasibility',
              },
              confidence: 0.41,
              recommended: false,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Opportunity Discovery')).toBeInTheDocument();

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    });

    await waitFor(() => {
      expect(selectTools).toHaveBeenCalledWith('initiative-123', ['landscape_mapping']);
      expect(replace).toHaveBeenCalledWith('/initiatives/initiative-123?view=framework');
    });
  });
});
