import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AssessmentChecklistWidget } from '@/components/widgets/AssessmentChecklistWidget';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';

describe('AssessmentChecklistWidget', () => {
  beforeEach(() => {
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
    });
  });

  it('shows Start Task after confirm and starts the assessment', async () => {
    const selectTools = jest.fn().mockImplementation(async () => {
      useProjectStore.setState({
        error: null,
        project: {
          id: 'initiative-123',
          selected_tools: ['landscape_mapping'],
        } as any,
      });
    });
    const onStartAssessment = jest.fn().mockResolvedValue(undefined);

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
        onStartAssessment={onStartAssessment}
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
          ],
        }}
      />,
    );

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    });

    const startTask = await screen.findByRole('button', { name: 'Start Task' });
    await act(async () => {
      await userEvent.click(startTask);
    });

    await waitFor(() => {
      expect(onStartAssessment).toHaveBeenCalledWith('landscape_mapping', 'Landscape Mapping');
    });
  });

  it('does not fall back to selecting the full catalog when nothing is recommended', async () => {
    const selectTools = jest.fn();

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
              confidence: 0.1,
              recommended: false,
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
              confidence: 0.1,
              recommended: false,
            },
          ],
        }}
      />,
    );

    expect(screen.queryByText('Landscape Mapping')).not.toBeInTheDocument();
    expect(screen.queryByText('LCOE Model')).not.toBeInTheDocument();
  });
});
