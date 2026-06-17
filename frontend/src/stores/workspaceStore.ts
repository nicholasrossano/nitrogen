import { create } from 'zustand';
import { api, Workspace, WorkspaceDetail, WorkspaceMember } from '@/lib/api';

const ACTIVE_WORKSPACE_KEY = 'nitrogen-active-workspace-id';
const LAST_TOUCHED_WORKSPACE_KEY = 'nitrogen-last-touched-workspace-id';
let loadWorkspacesRequestSeq = 0;
let loadWorkspacesPromise: Promise<void> | null = null;

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  activeWorkspaceDetail: WorkspaceDetail | null;
  loading: boolean;
  error: string | null;
  loadWorkspaces: () => Promise<void>;
  setActiveWorkspace: (workspaceId: string) => Promise<void>;
  createWorkspace: (name: string, description?: string | null) => Promise<WorkspaceDetail>;
  updateActiveWorkspace: (data: { name?: string; icon?: string; description?: string | null }) => Promise<void>;
  deleteActiveWorkspace: () => Promise<void>;
  addMember: (email: string) => Promise<WorkspaceMember>;
  removeMember: (membershipId: string) => Promise<void>;
}

function readStoredWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

function writeStoredWorkspaceId(workspaceId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);
    localStorage.setItem(LAST_TOUCHED_WORKSPACE_KEY, workspaceId);
  } catch {
    // Non-fatal; server membership remains the source of truth.
  }
}

function readPreferredWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const lastTouched = localStorage.getItem(LAST_TOUCHED_WORKSPACE_KEY);
    if (lastTouched) return lastTouched;
    return localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

function pickFallbackWorkspace(workspaces: Workspace[]): Workspace | null {
  if (workspaces.length === 0) return null;
  const team = workspaces.find((w) => w.workspace_type === 'team');
  if (team) return team;
  return [...workspaces].sort((a, b) => {
    const aTime = Date.parse(a.updated_at || a.created_at || '');
    const bTime = Date.parse(b.updated_at || b.created_at || '');
    if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
    if (Number.isNaN(aTime)) return 1;
    if (Number.isNaN(bTime)) return -1;
    return bTime - aTime;
  })[0] ?? workspaces[0];
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeWorkspace: null,
  activeWorkspaceDetail: null,
  loading: false,
  error: null,

  loadWorkspaces: async () => {
    const current = get();
    if (current.activeWorkspace && current.workspaces.length > 0) {
      return;
    }
    if (loadWorkspacesPromise) {
      await loadWorkspacesPromise;
      return;
    }

    const requestId = ++loadWorkspacesRequestSeq;
    loadWorkspacesPromise = (async () => {
      set({ loading: true, error: null });
      try {
        const workspaces = await api.listWorkspaces();
        if (requestId !== loadWorkspacesRequestSeq) return;
        const preferredId = readPreferredWorkspaceId();
        const activeWorkspace =
          workspaces.find((workspace) => workspace.id === preferredId) ??
          pickFallbackWorkspace(workspaces) ??
          null;

        if (activeWorkspace) {
          writeStoredWorkspaceId(activeWorkspace.id);
        }
        set({ workspaces, activeWorkspace, loading: false });

        if (activeWorkspace) {
          try {
            const activeWorkspaceDetail = await api.getWorkspace(activeWorkspace.id);
            if (requestId === loadWorkspacesRequestSeq && get().activeWorkspace?.id === activeWorkspace.id) {
              set({ activeWorkspaceDetail });
            }
          } catch (detailError) {
            console.warn('Failed to load workspace details:', detailError);
          }
        }
      } catch (error) {
        if (requestId !== loadWorkspacesRequestSeq) return;
        set({
          error: error instanceof Error ? error.message : 'Failed to load workspaces',
          loading: false,
        });
      } finally {
        if (requestId === loadWorkspacesRequestSeq) {
          loadWorkspacesPromise = null;
        }
      }
    })();

    await loadWorkspacesPromise;
  },

  setActiveWorkspace: async (workspaceId: string) => {
    const workspace = get().workspaces.find((item) => item.id === workspaceId) ?? null;
    if (!workspace) return;
    writeStoredWorkspaceId(workspaceId);
    set({ activeWorkspace: workspace, activeWorkspaceDetail: null });
    const activeWorkspaceDetail = await api.getWorkspace(workspaceId);
    set({ activeWorkspace: workspace, activeWorkspaceDetail });
  },

  createWorkspace: async (name: string, description?: string | null) => {
    const detail = await api.createWorkspace(name, description);
    writeStoredWorkspaceId(detail.id);
    const workspaces = await api.listWorkspaces();
    const activeWorkspace = workspaces.find((workspace) => workspace.id === detail.id) ?? detail;
    set({ workspaces, activeWorkspace, activeWorkspaceDetail: detail });
    return detail;
  },

  updateActiveWorkspace: async (data) => {
    const active = get().activeWorkspace;
    if (!active) return;
    const detail = await api.updateWorkspace(active.id, data);
    const workspaces = get().workspaces.map((workspace) =>
      workspace.id === detail.id ? { ...workspace, ...detail } : workspace
    );
    writeStoredWorkspaceId(detail.id);
    set({ workspaces, activeWorkspace: { ...active, ...detail }, activeWorkspaceDetail: detail });
  },

  deleteActiveWorkspace: async () => {
    const active = get().activeWorkspace;
    if (!active) return;

    await api.deleteWorkspace(active.id);

    const workspaces = await api.listWorkspaces();
    const storedId = readStoredWorkspaceId();
    const nextActive =
      workspaces.find((workspace) => workspace.id === storedId && workspace.id !== active.id) ??
      workspaces.find((workspace) => workspace.workspace_type === 'personal') ??
      workspaces[0] ??
      null;

    if (!nextActive) {
      set({ workspaces: [], activeWorkspace: null, activeWorkspaceDetail: null });
      return;
    }

    writeStoredWorkspaceId(nextActive.id);
    set({ workspaces, activeWorkspace: nextActive, activeWorkspaceDetail: null });
    const activeWorkspaceDetail = await api.getWorkspace(nextActive.id);
    set({ activeWorkspaceDetail });
  },

  addMember: async (email: string) => {
    const active = get().activeWorkspace;
    if (!active) throw new Error('No active workspace');
    const member = await api.addWorkspaceMember(active.id, email);
    const activeWorkspaceDetail = await api.getWorkspace(active.id);
    writeStoredWorkspaceId(active.id);
    set({ activeWorkspaceDetail });
    return member;
  },

  removeMember: async (membershipId: string) => {
    const active = get().activeWorkspace;
    if (!active) return;
    await api.removeWorkspaceMember(active.id, membershipId);
    const activeWorkspaceDetail = await api.getWorkspace(active.id);
    writeStoredWorkspaceId(active.id);
    set({ activeWorkspaceDetail });
  },
}));
