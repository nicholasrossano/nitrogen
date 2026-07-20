/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewProjectPage from '@/app/(shell)/projects/new/page';

const replace = jest.fn();
const back = jest.fn();
const createProject = jest.fn();
const loadWorkspaces = jest.fn();
let activeWorkspace: { id: string } | null = { id: 'ws-1' };
let demoActive = false;

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, back, push: jest.fn() }),
}));

jest.mock('@/components/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/lib/demo/demoSession', () => ({
  isDemoActive: () => demoActive,
}));

jest.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: () => ({
    activeWorkspace,
    loadWorkspaces,
  }),
}));

jest.mock('@/lib/api', () => ({
  api: {
    createProject: (...args: unknown[]) => createProject(...args),
  },
}));

describe('NewProjectPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    demoActive = false;
    activeWorkspace = { id: 'ws-1' };
    createProject.mockResolvedValue({ id: 'proj-new' });
  });

  it('shows the three educational onboarding boxes without creating a project on mount', () => {
    render(<NewProjectPage />);

    expect(screen.getByText('Describe the project')).toBeInTheDocument();
    expect(screen.getByText('Upload supporting files')).toBeInTheDocument();
    expect(screen.getByText('Confirm recommended assessments')).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });

  it('Back uses history navigation so no orphan project is left behind', () => {
    render(<NewProjectPage />);
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(createProject).not.toHaveBeenCalled();
  });

  it('creates the project only on first send and hands off via ?seed=', async () => {
    render(<NewProjectPage />);

    fireEvent.change(
      screen.getByPlaceholderText(/Briefly describe the project/i),
      { target: { value: 'Rift Valley solar mini-grid' } },
    );
    fireEvent.click(screen.getByRole('button', { name: /start project/i }));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith('New Project', 'ws-1');
      expect(replace).toHaveBeenCalledWith(
        `/projects/proj-new?seed=${encodeURIComponent('Rift Valley solar mini-grid')}`,
      );
    });
  });

  it('redirects demo sessions away from new-project onboarding', async () => {
    demoActive = true;
    render(<NewProjectPage />);
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/chat');
    });
  });
});
