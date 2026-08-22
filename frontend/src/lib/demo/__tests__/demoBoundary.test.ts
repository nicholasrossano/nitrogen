import { track } from '@vercel/analytics';
import {
  beginDemoEntry,
  endDemoEntry,
  enterDemo,
  exitDemo,
  isDemoActive,
  isDemoEntryInProgress,
  isDemoProjectPath,
  isLeavingDemoForAuth,
} from '@/lib/demo/demoSession';
import {
  leaveDemoForSignup,
  leaveDemoSession,
  resetClientStateForDemoBoundary,
  startDemoSession,
} from '@/lib/demo/demoBoundary';
import { useProjectStore } from '@/stores/projectStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

jest.mock('@vercel/analytics', () => ({
  track: jest.fn(),
}));

describe('demoBoundary', () => {
  beforeEach(() => {
    (track as jest.Mock).mockClear();
    exitDemo();
    endDemoEntry();
    resetClientStateForDemoBoundary();
  });

  afterEach(() => {
    exitDemo();
    endDemoEntry();
  });

  it('leaveDemoForSignup marks leaving, clears demo, and navigates to signup', () => {
    enterDemo();
    const navigate = jest.fn();

    leaveDemoForSignup(navigate);

    expect(isLeavingDemoForAuth()).toBe(true);
    expect(isDemoActive()).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/login?mode=signup');
  });

  it('startDemoSession sets the demo flag before awaiting sign-out', async () => {
    let sawDemoDuringSignOut = false;
    const signOut = jest.fn().mockImplementation(async () => {
      sawDemoDuringSignOut = isDemoActive();
    });
    await startDemoSession({ hasUser: true, signOut });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(sawDemoDuringSignOut).toBe(true);
    expect(isDemoActive()).toBe(true);
    expect(isDemoEntryInProgress()).toBe(false);
    expect(track).toHaveBeenCalledWith('demo_open');
  });

  it('leaveDemoSession is a no-op while demo entry is in progress', () => {
    beginDemoEntry();
    enterDemo();
    leaveDemoSession();
    expect(isDemoActive()).toBe(true);
    expect(isDemoEntryInProgress()).toBe(true);
    endDemoEntry();
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

  it('resetClientStateForDemoBoundary clears any last-project preference', () => {
    localStorage.setItem('nitrogen-last-project-id', 'real-project-uuid');
    resetClientStateForDemoBoundary();
    expect(localStorage.getItem('nitrogen-last-project-id')).toBeNull();
  });

  it('enterDemo alone does not write persistent workspace prefs', () => {
    const before = localStorage.getItem('nitrogen-active-workspace-id');
    enterDemo();
    expect(localStorage.getItem('nitrogen-active-workspace-id')).toBe(before);
  });

  it('isDemoProjectPath recognizes the fixture project route', () => {
    expect(isDemoProjectPath('/projects/demo-rift-valley-solar')).toBe(true);
    expect(isDemoProjectPath('/projects/demo-rift-valley-solar/')).toBe(true);
    expect(isDemoProjectPath('/projects/other')).toBe(false);
    expect(isDemoProjectPath('/demo')).toBe(false);
  });
});
