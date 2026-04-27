import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ModuleWorkspace } from '@/components/modules/ModuleWorkspace';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  api: {
    getStagedModuleWorkflowState: jest.fn(),
    confirmStage: jest.fn(),
    approveFinalModuleOutput: jest.fn(),
  },
}));

jest.mock('@/components/modules/stages/EditableTableStage', () => ({
  EditableTableStage: () => <div>Editable table stage</div>,
}));

jest.mock('@/components/modules/stages/CategorizedListStage', () => ({
  CategorizedListStage: () => <div>Categorized list stage</div>,
}));

jest.mock('@/components/modules/stages/CategorizedWorkspaceStage', () => ({
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
    module_id: 'implementation_plan',
    status: 'started',
    workflow_version: 3,
    module_definition: {
      id: 'implementation_plan',
      name: 'Implementation Plan',
      description: 'Plan execution workstreams',
      icon: 'Network',
      output_type: 'implementation_plan',
      category: 'planning',
      export_format: null,
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
      module_type: 'implementation_plan',
      current_stage_id: 'plan',
      final_approval: {
        status: 'pending',
        approved_at: null,
        approved_by: null,
        approved_by_email: null,
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
          confirmed_at: null,
          confirmed_by: null,
          confirmed_by_email: null,
          data: { widget_data: { groups: [] } },
        },
      },
    },
  };
}

describe('ModuleWorkspace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps backend-confirmed stages navigable and read-only when revisiting them', async () => {
    mockedApi.getStagedModuleWorkflowState.mockResolvedValue(buildWorkflowState() as any);

    render(<ModuleWorkspace instanceId="instance-1" moduleId="implementation_plan" />);

    await screen.findByText('Implementation plan widget');

    const categoriesButton = screen.getByRole('button', { name: 'Categories' });
    const activitiesButton = screen.getByRole('button', { name: 'Activities' });

    expect(categoriesButton).not.toBeDisabled();
    expect(activitiesButton).not.toBeDisabled();

    fireEvent.click(categoriesButton);

    await screen.findByText('Categorized list stage');
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();

    fireEvent.click(activitiesButton);

    await screen.findByText('Categorized workspace stage');
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('approves a terminal computed stage without showing an export action', async () => {
    mockedApi.getStagedModuleWorkflowState.mockResolvedValue(buildWorkflowState() as any);
    mockedApi.approveFinalModuleOutput.mockResolvedValue({
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

    render(<ModuleWorkspace instanceId="instance-1" moduleId="implementation_plan" />);

    await screen.findByText('Implementation plan widget');

    const approveButton = screen.getByRole('button', { name: 'Approve' });
    expect(approveButton).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();

    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(mockedApi.approveFinalModuleOutput).toHaveBeenCalledWith('instance-1', 3);
    });

    await waitFor(() => {
      expect(screen.getAllByText(/Approved/).length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
  });

  it('does not show a confirmed footer for a terminal stage awaiting final approval', async () => {
    mockedApi.getStagedModuleWorkflowState.mockResolvedValue(buildWorkflowState({
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

    render(<ModuleWorkspace instanceId="instance-1" moduleId="implementation_plan" />);

    await screen.findByText('Implementation plan widget');

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.queryByText(/^Confirmed/)).not.toBeInTheDocument();
  });
});
