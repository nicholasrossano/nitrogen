import {
  resetClientStores,
  syncAuthSessionBoundary,
} from '@/lib/sessionBoundary';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useTourStore } from '@/stores/tourStore';
import { useProjectStore } from '@/stores/projectStore';

const AUTH_UID_KEY = 'nitrogen-auth-uid';
const LAST_PROJECT_KEY = 'nitrogen-last-project-id';
const ACTIVE_WORKSPACE_KEY = 'nitrogen-active-workspace-id';
const LAST_TOUCHED_WORKSPACE_KEY = 'nitrogen-last-touched-workspace-id';

describe('syncAuthSessionBoundary', () => {
  beforeEach(() => {
    localStorage.clear();
    resetClientStores();
    useTourStore.setState({
      completedStepIds: [],
      welcomeCompleted: false,
      welcomeActive: false,
      activeStepId: null,
      activeGroup: null,
      replayNonce: 0,
    });
  });

  it('stamps the first uid and clears orphan prefs from a prior browser session', () => {
    localStorage.setItem(LAST_PROJECT_KEY, 'proj-orphan');
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, 'ws-orphan');
    useTourStore.setState({ welcomeCompleted: true, completedStepIds: ['welcome-workspace'] });

    syncAuthSessionBoundary('user-a');

    expect(localStorage.getItem(AUTH_UID_KEY)).toBe('user-a');
    expect(localStorage.getItem(LAST_PROJECT_KEY)).toBeNull();
    expect(localStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBeNull();
    expect(useTourStore.getState().welcomeCompleted).toBe(false);
  });

  it('clears cross-account prefs when the firebase uid changes', () => {
    localStorage.setItem(AUTH_UID_KEY, 'user-a');
    localStorage.setItem(LAST_PROJECT_KEY, 'proj-a');
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, 'ws-a');
    localStorage.setItem(LAST_TOUCHED_WORKSPACE_KEY, 'ws-a');
    useTourStore.setState({ welcomeCompleted: true, completedStepIds: ['welcome-workspace'] });
    useWorkspaceStore.setState({
      workspaces: [{ id: 'ws-a' } as any],
      activeWorkspace: { id: 'ws-a' } as any,
    });
    useProjectStore.setState({
      project: { id: 'proj-a' } as any,
      projectsById: { 'proj-a': { id: 'proj-a' } as any },
    });

    syncAuthSessionBoundary('user-b');

    expect(localStorage.getItem(AUTH_UID_KEY)).toBe('user-b');
    expect(localStorage.getItem(LAST_PROJECT_KEY)).toBeNull();
    expect(localStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBeNull();
    expect(localStorage.getItem(LAST_TOUCHED_WORKSPACE_KEY)).toBeNull();
    expect(useTourStore.getState().welcomeCompleted).toBe(false);
    expect(useTourStore.getState().completedStepIds).toEqual([]);
    expect(useWorkspaceStore.getState().activeWorkspace).toBeNull();
    expect(useProjectStore.getState().project).toBeNull();
    expect(useProjectStore.getState().projectsById).toEqual({});
  });

  it('is a no-op for the same uid so refresh keeps prefs', () => {
    localStorage.setItem(AUTH_UID_KEY, 'user-a');
    localStorage.setItem(LAST_PROJECT_KEY, 'proj-a');

    syncAuthSessionBoundary('user-a');

    expect(localStorage.getItem(LAST_PROJECT_KEY)).toBe('proj-a');
  });

  it('clears memory on sign-out but keeps the stored uid for same-user re-login', () => {
    localStorage.setItem(AUTH_UID_KEY, 'user-a');
    localStorage.setItem(LAST_PROJECT_KEY, 'proj-a');
    useWorkspaceStore.setState({
      workspaces: [{ id: 'ws-a' } as any],
      activeWorkspace: { id: 'ws-a' } as any,
    });

    syncAuthSessionBoundary(null);

    expect(localStorage.getItem(AUTH_UID_KEY)).toBe('user-a');
    expect(localStorage.getItem(LAST_PROJECT_KEY)).toBe('proj-a');
    expect(useWorkspaceStore.getState().activeWorkspace).toBeNull();
  });

  it('does not wipe client stores on signed-out auth while demo is active', async () => {
    const { enterDemo, exitDemo } = await import('@/lib/demo/demoSession');
    enterDemo();
    useProjectStore.setState({
      project: { id: 'demo-rift-valley-solar', title: 'Rift Valley Solar' } as any,
      projectsById: {
        'demo-rift-valley-solar': { id: 'demo-rift-valley-solar', title: 'Rift Valley Solar' } as any,
      },
    });

    syncAuthSessionBoundary(null);

    expect(useProjectStore.getState().project?.id).toBe('demo-rift-valley-solar');
    expect(useProjectStore.getState().projectsById['demo-rift-valley-solar']?.title).toBe(
      'Rift Valley Solar',
    );
    exitDemo();
  });
});
