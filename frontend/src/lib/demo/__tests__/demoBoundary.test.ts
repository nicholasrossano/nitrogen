import { enterDemo, exitDemo, isDemoActive } from '@/lib/demo/demoSession';
import {
  leaveDemoSession,
  resetClientStateForDemoBoundary,
  startDemoSession,
} from '@/lib/demo/demoBoundary';
import { useProjectStore } from '@/stores/projectStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

describe('demoBoundary', () => {
  beforeEach(() => {
    exitDemo();
    resetClientStateForDemoBoundary();
  });

  afterEach(() => {
    exitDemo();
  });

  it('startDemoSession sets the demo flag after optional sign-out', async () => {
    const signOut = jest.fn().mockResolvedValue(undefined);
    await startDemoSession({ hasUser: true, signOut });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(isDemoActive()).toBe(true);
  });

  it('leaveDemoSession clears demo flag and in-memory stores', async () => {
    const { setCached, getCached, swrKeys } = await import('@/lib/swrCache');
    await startDemoSession();
    setCached(swrKeys.project('demo-rift-valley-solar'), { id: 'demo-rift-valley-solar' });
    useProjectStore.setState({
      project: { id: 'demo-rift-valley-solar' } as any,
      projectsById: { 'demo-rift-valley-solar': { id: 'demo-rift-valley-solar' } as any },
    });
    useWorkspaceStore.setState({
      workspaces: [{ id: 'demo-workspace' } as any],
      activeWorkspace: { id: 'demo-workspace' } as any,
    });

    leaveDemoSession();

    expect(isDemoActive()).toBe(false);
    expect(useProjectStore.getState().project).toBeNull();
    expect(useProjectStore.getState().projectsById).toEqual({});
    expect(useWorkspaceStore.getState().activeWorkspace).toBeNull();
    expect(useWorkspaceStore.getState().workspaces).toEqual([]);
    expect(getCached(swrKeys.project('demo-rift-valley-solar'))).toBeUndefined();
  });

  it('enterDemo alone does not write persistent workspace prefs', () => {
    const before = localStorage.getItem('nitrogen-active-workspace-id');
    enterDemo();
    expect(localStorage.getItem('nitrogen-active-workspace-id')).toBe(before);
  });
});
