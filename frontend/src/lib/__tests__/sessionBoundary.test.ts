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
      activeUid: null,
      byUid: {},
    });
  });

  it('stamps the first uid and binds tour without wiping live project state', () => {
    localStorage.setItem(LAST_PROJECT_KEY, 'proj-orphan');
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, 'ws-orphan');
    useTourStore.setState({ welcomeCompleted: true, completedStepIds: ['welcome-workspace'] });
    useProjectStore.setState({
      project: { id: 'proj-live', title: 'Live Project' } as any,
      projectsById: { 'proj-live': { id: 'proj-live', title: 'Live Project' } as any },
    });

    syncAuthSessionBoundary('user-a');

    expect(localStorage.getItem(AUTH_UID_KEY)).toBe('user-a');
    expect(localStorage.getItem(LAST_PROJECT_KEY)).toBeNull();
    expect(localStorage.getItem(ACTIVE_WORKSPACE_KEY)).toBeNull();
    // Orphan pre-auth completion is claimed for this uid.
    expect(useTourStore.getState().activeUid).toBe('user-a');
    expect(useTourStore.getState().welcomeCompleted).toBe(true);
    expect(useTourStore.getState().completedStepIds).toEqual(['welcome-workspace']);
    expect(useTourStore.getState().byUid['user-a']?.welcomeCompleted).toBe(true);
    expect(useProjectStore.getState().project?.id).toBe('proj-live');
    expect(useProjectStore.getState().projectsById['proj-live']?.title).toBe('Live Project');
  });

  it('restores each account\'s tour prefs when the firebase uid changes', () => {
    localStorage.setItem(AUTH_UID_KEY, 'user-a');
    localStorage.setItem(LAST_PROJECT_KEY, 'proj-a');
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, 'ws-a');
    localStorage.setItem(LAST_TOUCHED_WORKSPACE_KEY, 'ws-a');
    useTourStore.setState({
      activeUid: 'user-a',
      welcomeCompleted: true,
      completedStepIds: ['welcome-workspace'],
      byUid: {
        'user-a': { welcomeCompleted: true, completedStepIds: ['welcome-workspace'] },
        'user-b': { welcomeCompleted: false, completedStepIds: [] },
      },
    });
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
    expect(useTourStore.getState().activeUid).toBe('user-b');
    expect(useTourStore.getState().welcomeCompleted).toBe(false);
    expect(useTourStore.getState().completedStepIds).toEqual([]);
    // User A's progress must survive the switch.
    expect(useTourStore.getState().byUid['user-a']?.welcomeCompleted).toBe(true);
    expect(useWorkspaceStore.getState().activeWorkspace).toBeNull();
    expect(useProjectStore.getState().project).toBeNull();
    expect(useProjectStore.getState().projectsById).toEqual({});

    syncAuthSessionBoundary('user-a');
    expect(useTourStore.getState().activeUid).toBe('user-a');
    expect(useTourStore.getState().welcomeCompleted).toBe(true);
    expect(useTourStore.getState().completedStepIds).toEqual(['welcome-workspace']);
  });

  it('is a no-op for the same uid so refresh keeps prefs', () => {
    localStorage.setItem(AUTH_UID_KEY, 'user-a');
    localStorage.setItem(LAST_PROJECT_KEY, 'proj-a');
    useTourStore.setState({
      activeUid: 'user-a',
      welcomeCompleted: true,
      completedStepIds: ['welcome-workspace'],
      byUid: {
        'user-a': { welcomeCompleted: true, completedStepIds: ['welcome-workspace'] },
      },
    });

    syncAuthSessionBoundary('user-a');

    expect(localStorage.getItem(LAST_PROJECT_KEY)).toBe('proj-a');
    expect(useTourStore.getState().welcomeCompleted).toBe(true);
  });

  it('clears memory on sign-out but restores tour for the same user on re-login', () => {
    localStorage.setItem(AUTH_UID_KEY, 'user-a');
    localStorage.setItem(LAST_PROJECT_KEY, 'proj-a');
    useTourStore.setState({
      activeUid: 'user-a',
      welcomeCompleted: true,
      completedStepIds: ['welcome-workspace'],
      byUid: {
        'user-a': { welcomeCompleted: true, completedStepIds: ['welcome-workspace'] },
      },
    });
    useWorkspaceStore.setState({
      workspaces: [{ id: 'ws-a' } as any],
      activeWorkspace: { id: 'ws-a' } as any,
    });

    syncAuthSessionBoundary(null);

    expect(localStorage.getItem(AUTH_UID_KEY)).toBe('user-a');
    expect(localStorage.getItem(LAST_PROJECT_KEY)).toBe('proj-a');
    expect(useWorkspaceStore.getState().activeWorkspace).toBeNull();
    expect(useTourStore.getState().activeUid).toBeNull();
    expect(useTourStore.getState().welcomeCompleted).toBe(false);
    expect(useTourStore.getState().byUid['user-a']?.welcomeCompleted).toBe(true);

    syncAuthSessionBoundary('user-a');
    expect(useTourStore.getState().activeUid).toBe('user-a');
    expect(useTourStore.getState().welcomeCompleted).toBe(true);
    expect(useTourStore.getState().completedStepIds).toEqual(['welcome-workspace']);
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

  it('keeps live Home title/Overview cache when a late auth null is not a real sign-out after stamp', () => {
    // First stamp must not clear in-memory project state that Home already painted.
    useProjectStore.setState({
      project: { id: 'proj-live', title: 'Acme Hydro' } as any,
      projectsById: { 'proj-live': { id: 'proj-live', title: 'Acme Hydro' } as any },
    });
    syncAuthSessionBoundary('user-live');
    expect(useProjectStore.getState().project?.title).toBe('Acme Hydro');

    // Same uid refresh is a no-op — Overview must not flicker empty.
    syncAuthSessionBoundary('user-live');
    expect(useProjectStore.getState().project?.id).toBe('proj-live');
    expect(useProjectStore.getState().projectsById['proj-live']?.title).toBe('Acme Hydro');
  });
});
