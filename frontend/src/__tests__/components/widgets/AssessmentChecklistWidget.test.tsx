import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AssessmentChecklistWidget } from '@/components/widgets/AssessmentChecklistWidget';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';

const replace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace,
  }),
}));

describe('AssessmentChecklistWidget', () => {
  beforeEach(() => {
    replace.mockReset();
    useSettingsStore.setState({ devMode: false });
    useProjectStore.setState({
      project: { id: 'initiative-123', selected_tools: null } as any,
      projectPlan: null,
      error: null,
      selectTools: async () => undefined,
      generateProjectPlan: async () => undefined,
    });
  });

  it('groups recommended assessments by framework category and confirms the selection', async () => {
    const selectTools = jest.fn().mockImplementation(async () => {
      useProjectStore.setState({
        error: null,
        project: {
          id: 'initiative-123',
          selected_tools: ['landscape_mapping'],
        } as any,
      });
    });

    useProjectStore.setState({
      project: { id: 'initiative-123', selected_tools: null } as any,
      projectPlan: null,
      error: null,
      selectTools,
    });

    render(
      <AssessmentChecklistWidget
        projectId="initiative-123"
        isActive
        data={{
          title: 'Recommended Framework Assessments',
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
      expect(replace).toHaveBeenCalledWith('/projects/initiative-123?view=framework');
    });
  });
});
