import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AssessmentWorkspace } from '@/components/assessments/AssessmentWorkspace';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  api: {
    getStagedAssessmentWorkflowState: jest.fn(),
    getAssessmentAgentStatus: jest.fn(),
    runAssessment: jest.fn(),
    confirmStage: jest.fn(),
    approveFinalAssessmentOutput: jest.fn(),
    revokeFinalAssessmentApproval: jest.fn(),
  },
}));

jest.mock('@/components/assessments/stages/EditableTableStage', () => ({
  EditableTableStage: () => <div>Editable table stage</div>,
}));

jest.mock('@/components/assessments/stages/CategorizedListStage', () => ({
  CategorizedListStage: () => <div>Categorized list stage</div>,
}));

jest.mock('@/components/assessments/stages/CategorizedWorkspaceStage', () => ({
  CategorizedWorkspaceStage: () => <div>Categorized workspace stage</div>,
}));

jest.mock('@/lib/widgetRegistry', () => ({
  WIDGET_REGISTRY: {
    implementation_plan: () => Promise.resolve({
      default: () => <div>Implementation plan widget</div>,
    }),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;

function buildWorkflowState(overrides?: Partial<ReturnType<typeof baseWorkflowState>>) {
  return {
    ...baseWorkflowState(),
    ...overrides,
  };
}

function baseWorkflowState() {
  return {
    instance_id: 'instance-1',
    assessment_id: 'implementation_plan',
    status: 'started',
    workflow_version: 3,
    assessment_definition: {
      id: 'implementation_plan',
      name: 'Implementation Plan',
      description: 'Plan execution workstreams',
      icon: 'Network',
      output_type: 'implementation_plan',
      category: 'planning',
      export_format: null as string | null,
      requires_final_approval: true,
      stage_defs: [
        {
          id: 'phases',
          title: 'Categories',
          component: 'list',
          widget: 'categorized_list',
          allow_add_rows: false,
          fields: [],
          population: [],
        },
        {
          id: 'activities',
          title: 'Activities',
          component: 'list',
          widget: 'categorized_workspace',
          allow_add_rows: false,
          fields: [],
          population: [],
        },
        {
          id: 'plan',
          title: 'Plan',
          component: 'computed_results',
          widget: 'implementation_plan',
          allow_add_rows: false,
          fields: [],
          population: [],
        },
      ],
    },
    workflow_state: {
      assessment_type: 'implementation_plan',
      current_stage_id: 'plan',
      final_approval: {
        status: 'pending',
        approved_at: null as string | null,
        approved_by: null as string | null,
        approved_by_email: null as string | null,
      },
      stages: {
        phases: {
          status: 'confirmed',
          confirmed_at: '2026-04-22T12:00:00Z',
          confirmed_by: 'user-1',
          confirmed_by_email: 'user@example.com',
          data: { items: [{ id: 'cat-1', content: { label: 'Category 1' } }] },
        },
        activities: {
          status: 'confirmed',
          confirmed_at: '2026-04-22T12:05:00Z',
          confirmed_by: 'user-1',
          confirmed_by_email: 'user@example.com',
          data: { items: [{ id: 'activity-1', content: { name: 'Activity 1', category: 'Category 1' } }] },
        },
        plan: {
          status: 'draft',
          confirmed_at: null as string | null,
          confirmed_by: null as string | null,
          confirmed_by_email: null as string | null,
          data: { widget_data: { groups: [] } },
        },
      },
    },
  };
}

describe('AssessmentWorkspace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.getAssessmentAgentStatus.mockResolvedValue({
      run_state: 'needs_review',
      current_stage_id: 'plan',
      current_action: null,
      last_summary: 'Needs review for plan.',
      workflow_version: 3,
      can_resume: true,
    } as any);
    mockedApi.runAssessment.mockResolvedValue({
      run_state: 'needs_review',
      current_stage_id: 'plan',
      current_action: null,
      last_summary: 'Needs review for plan.',
      workflow_version: 3,
      can_resume: true,
    } as any);
  });

  it('keeps backend-confirmed stages navigable and read-only when revisiting them', async () => {
    mockedApi.getStagedAssessmentWorkflowState.mockResolvedValue(buildWorkflowState() as any);

    render(<AssessmentWorkspace instanceId="instance-1" assessmentId="implementation_plan" />);

    await screen.findByText('Implementation plan widget');

    const categoriesButton = screen.getByRole('button', { name: 'Categories' });
    const activitiesButton = screen.getByRole('button', { name: 'Activities' });

    expect(categoriesButton).not.toBeDisabled();
    expect(activitiesButton).not.toBeDisabled();

    fireEvent.click(categoriesButton);

    await screen.findByText('Categorized list stage');
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Confirm' })).toHaveLength(1);

    fireEvent.click(activitiesButton);

    await screen.findByText('Categorized workspace stage');
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Confirm' })).toHaveLength(1);
  });

  it('approves a terminal computed stage without showing an export action', async () => {
    mockedApi.getStagedAssessmentWorkflowState.mockResolvedValue(buildWorkflowState() as any);
    mockedApi.approveFinalAssessmentOutput.mockResolvedValue({
      workflow_state: {
        ...buildWorkflowState().workflow_state,
        final_approval: {
          status: 'approved',
          approved_at: '2026-04-22T12:10:00Z',
          approved_by: 'user-1',
          approved_by_email: 'user@example.com',
        },
        stages: {
          ...buildWorkflowState().workflow_state.stages,
          plan: {
            status: 'confirmed',
            confirmed_at: '2026-04-22T12:10:00Z',
            confirmed_by: 'user-1',
            confirmed_by_email: 'user@example.com',
            data: { widget_data: { groups: [] } },
          },
        },
      },
      workflow_version: 4,
    } as any);

    render(<AssessmentWorkspace instanceId="instance-1" assessmentId="implementation_plan" />);

    await screen.findByText('Implementation plan widget');

    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    expect(confirmButton).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();

    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockedApi.approveFinalAssessmentOutput).toHaveBeenCalledWith('instance-1', 3);
    });

    await waitFor(() => {
      expect(screen.getAllByText(/Confirmed/).length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
  });

  it('does not show a confirmed footer for a terminal stage awaiting final approval', async () => {
    mockedApi.getStagedAssessmentWorkflowState.mockResolvedValue(buildWorkflowState({
      workflow_state: {
        ...buildWorkflowState().workflow_state,
        stages: {
          ...buildWorkflowState().workflow_state.stages,
          plan: {
            status: 'confirmed',
            confirmed_at: '2026-04-22T12:10:00Z',
            confirmed_by: 'user-1',
            confirmed_by_email: 'user@example.com',
            data: { widget_data: { groups: [] } },
          },
        },
      },
    }) as any);

    render(<AssessmentWorkspace instanceId="instance-1" assessmentId="implementation_plan" />);

    await screen.findByText('Implementation plan widget');

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.queryByText(/^Confirmed$/)).not.toBeInTheDocument();
  });

  it('shows export before approval only on the final stage for exportable assessments', async () => {
    mockedApi.getStagedAssessmentWorkflowState.mockResolvedValue(buildWorkflowState({
      assessment_definition: {
        ...buildWorkflowState().assessment_definition,
        export_format: 'xlsx',
      },
      workflow_state: {
        ...buildWorkflowState().workflow_state,
        stages: {
          ...buildWorkflowState().workflow_state.stages,
          plan: {
            status: 'confirmed',
            confirmed_at: '2026-04-22T12:10:00Z',
            confirmed_by: 'user-1',
            confirmed_by_email: 'user@example.com',
            data: { widget_data: { groups: [] } },
          },
        },
      },
    }) as any);

    render(<AssessmentWorkspace instanceId="instance-1" assessmentId="implementation_plan" initiativeId="initiative-1" />);

    await screen.findByText('Implementation plan widget');

    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    const actionLabels = screen.getAllByRole('button')
      .map((button) => button.textContent?.trim())
      .filter((label) => label === 'Log' || label === 'Export' || label === 'Confirm');
    expect(actionLabels).toEqual(['Log', 'Export', 'Confirm']);

    fireEvent.click(screen.getByRole('button', { name: 'Categories' }));

    await screen.findByText('Categorized list stage');
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('reverts final approval to an approvable state', async () => {
    mockedApi.getStagedAssessmentWorkflowState.mockResolvedValue(buildWorkflowState({
      workflow_version: 4,
      workflow_state: {
        ...buildWorkflowState().workflow_state,
        final_approval: {
          status: 'approved',
          approved_at: '2026-04-22T12:10:00Z',
          approved_by: 'user-1',
          approved_by_email: 'user@example.com',
        },
        stages: {
          ...buildWorkflowState().workflow_state.stages,
          plan: {
            status: 'confirmed',
            confirmed_at: '2026-04-22T12:10:00Z',
            confirmed_by: 'user-1',
            confirmed_by_email: 'user@example.com',
            data: { widget_data: { groups: [] } },
          },
        },
      },
    }) as any);
    mockedApi.revokeFinalAssessmentApproval.mockResolvedValue({
      workflow_state: {
        ...buildWorkflowState().workflow_state,
        final_approval: {
          status: 'pending',
          approved_at: null,
          approved_by: null,
          approved_by_email: null,
        },
        stages: {
          ...buildWorkflowState().workflow_state.stages,
          plan: {
            status: 'confirmed',
            confirmed_at: '2026-04-22T12:10:00Z',
            confirmed_by: 'user-1',
            confirmed_by_email: 'user@example.com',
            data: { widget_data: { groups: [] } },
          },
        },
      },
      workflow_version: 5,
    } as any);

    render(<AssessmentWorkspace instanceId="instance-1" assessmentId="implementation_plan" />);

    await screen.findByText('Implementation plan widget');

    const confirmedButton = screen.getByRole('button', { name: 'Confirmed' });
    expect(confirmedButton).toBeInTheDocument();

    fireEvent.click(confirmedButton);

    await waitFor(() => {
      expect(mockedApi.revokeFinalAssessmentApproval).toHaveBeenCalledWith('instance-1', 4);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    });
  });
});
