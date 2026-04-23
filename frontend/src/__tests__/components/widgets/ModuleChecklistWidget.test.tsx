import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ModuleChecklistWidget } from '@/components/widgets/ModuleChecklistWidget';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { useSettingsStore } from '@/stores/settingsStore';

describe('ModuleChecklistWidget', () => {
  beforeEach(() => {
    useSettingsStore.setState({ devMode: false });
    useInitiativeStore.setState({
      projectPlan: null,
      error: null,
      selectTools: async () => undefined,
      generateProjectPlan: async () => undefined,
    });
  });

  it('groups recommended modules by framework category and confirms the selection', async () => {
    const selectTools = jest.fn().mockImplementation(async () => {
      useInitiativeStore.setState({ error: null });
    });
    const generateProjectPlan = jest.fn().mockImplementation(async () => {
      useInitiativeStore.setState({ projectPlan: { pillars: [] } as any, error: null });
    });

    useInitiativeStore.setState({
      projectPlan: null,
      error: null,
      selectTools,
      generateProjectPlan,
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
    expect(screen.getByText('Feasibility & Option Analysis')).toBeInTheDocument();

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Confirm Framework Modules' }));
    });

    await waitFor(() => {
      expect(selectTools).toHaveBeenCalledWith('initiative-123', ['landscape_mapping']);
      expect(generateProjectPlan).toHaveBeenCalledWith('initiative-123');
    });
  });
});
