'use client';

import { useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, FolderOpen, Loader2, Trash2, Undo2, Search, ChevronDown, Check } from 'lucide-react';
import { api, Initiative, type ProjectMaterial } from '@/lib/api';
import { ProjectCard } from '@/components/projects';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { PageLoader } from '@/components/ui/PageLoader';
import { ShellPageHeader } from '@/components/ui';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { ProjectFilesView } from '@/components/files';
import { useShellNav } from '@/components/ui/ShellContext';
import type { NavItem } from '@/components/ui/SideDrawer';
import { useGoogleDriveStore } from '@/stores/googleDriveStore';
import { openGooglePicker } from '@/lib/googlePicker';

const PINNED_PROJECTS_STORAGE_KEY = 'nitrogen-pinned-project-ids';
const MAX_PINNED_PROJECTS = 3;

function withRequestTimeout<T>(promise: Promise<T>, message: string, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeout));
  });
}

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Initiative[]>([]);
  const [workspaceMaterials, setWorkspaceMaterials] = useState<ProjectMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTrashView, setIsTrashView] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pinnedProjectIds, setPinnedProjectIds] = useState<string[]>([]);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevCardPositionsRef = useRef<Map<string, DOMRect>>(new Map());
  const {
    activeWorkspace,
    workspaces,
    loading: workspaceLoading,
    error: workspaceError,
    loadWorkspaces,
    setActiveWorkspace,
  } = useWorkspaceStore();
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [workspaceSwitching, setWorkspaceSwitching] = useState(false);
  const workspaceSwitcherRef = useRef<HTMLDivElement>(null);
  const driveConnected = useGoogleDriveStore((s) => s.connected);
  const driveStatusChecked = useGoogleDriveStore((s) => s.statusChecked);
  const checkDriveStatus = useGoogleDriveStore((s) => s.checkStatus);
  const getDriveAccessToken = useGoogleDriveStore((s) => s.getAccessToken);
  const isFilesView = searchParams.get('view') === 'files';

  useEffect(() => {
    if (workspaceLoading || activeWorkspace || workspaces.length > 0) return;
    loadWorkspaces();
  }, [activeWorkspace, loadWorkspaces, workspaceLoading, workspaces.length]);

  useEffect(() => {
    if (!workspaceSwitcherOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!workspaceSwitcherRef.current?.contains(event.target as Node)) {
        setWorkspaceSwitcherOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [workspaceSwitcherOpen]);

  const workspaceOptions = useMemo(
    () => (workspaces.length > 0 ? workspaces : (activeWorkspace ? [activeWorkspace] : []))
      .filter((workspace, index, arr) => arr.findIndex((w) => w.id === workspace.id) === index),
    [activeWorkspace, workspaces],
  );

  const handleWorkspaceSwitch = useCallback(async (workspaceId: string) => {
    if (!workspaceId || workspaceId === activeWorkspace?.id) return;
    setWorkspaceSwitching(true);
    try {
      await setActiveWorkspace(workspaceId);
    } finally {
      setWorkspaceSwitching(false);
    }
  }, [activeWorkspace?.id, setActiveWorkspace]);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await withRequestTimeout(
        api.listInitiatives(20, 0, isTrashView, activeWorkspace?.id),
        'Projects took too long to load',
      );
      setProjects(data);
    } catch (err) {
      setError('Failed to load projects');
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, isTrashView]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const mapWorkspaceDocToMaterial = useCallback((doc: Awaited<ReturnType<typeof api.getWorkspaceEvidence>>[number]): ProjectMaterial => ({
    id: doc.id,
    filename: doc.filename ?? 'Untitled',
    file_type: doc.file_type ?? 'unknown',
    file_size: doc.file_size ?? null,
    created_at: doc.created_at,
    source: 'evidence',
    processing_status: doc.processing_status ?? undefined,
    processing_error: doc.processing_error ?? null,
  }), []);

  const loadWorkspaceFiles = useCallback(async () => {
    if (!activeWorkspace?.id) {
      setWorkspaceMaterials([]);
      return;
    }
    const docs = await api.getWorkspaceEvidence(activeWorkspace.id);
    setWorkspaceMaterials(docs.map(mapWorkspaceDocToMaterial));
  }, [activeWorkspace?.id, mapWorkspaceDocToMaterial]);

  const uploadWorkspaceFile = useCallback(async (file: File) => {
    if (!activeWorkspace?.id) {
      throw new Error('No active workspace selected');
    }
    const response = await api.uploadWorkspaceEvidence(activeWorkspace.id, file);
    setWorkspaceMaterials((prev) => [mapWorkspaceDocToMaterial(response.document), ...prev]);
  }, [activeWorkspace?.id, mapWorkspaceDocToMaterial]);

  const deleteWorkspaceFile = useCallback(async (materialId: string) => {
    await api.deleteEvidence(materialId);
    setWorkspaceMaterials((prev) => prev.filter((m) => m.id !== materialId));
  }, []);

  useEffect(() => {
    if (!isFilesView) return;
    loadWorkspaceFiles().catch((err) => {
      console.error('Failed to load workspace files:', err);
    });
  }, [isFilesView, loadWorkspaceFiles]);

  useEffect(() => {
    if (!isFilesView || driveStatusChecked) return;
    checkDriveStatus();
  }, [checkDriveStatus, driveStatusChecked, isFilesView]);

  const importWorkspaceFromDrive = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    if (!driveConnected) {
      throw new Error('Connect Google Drive from a project first, then try again.');
    }
    const accessToken = await getDriveAccessToken();
    await new Promise<void>((resolve, reject) => {
      openGooglePicker(
        accessToken,
        async (files) => {
          if (files.length === 0) {
            resolve();
            return;
          }
          try {
            await api.importWorkspaceFromDrive(activeWorkspace.id, files.map((file) => file.id));
            await loadWorkspaceFiles();
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        () => resolve(),
      );
    });
  }, [activeWorkspace?.id, driveConnected, getDriveAccessToken, loadWorkspaceFiles]);

  useShellNav(useCallback((item: NavItem): boolean => {
    if (item === 'files') {
      router.replace('/?view=files');
      return true;
    }
    if (item === 'home') {
      router.replace('/');
      return true;
    }
    return false;
  }, [router]));

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PINNED_PROJECTS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const normalized = parsed
        .filter((id): id is string => typeof id === 'string')
        .slice(0, MAX_PINNED_PROJECTS);
      setPinnedProjectIds(normalized);
    } catch (err) {
      console.warn('Failed to read pinned projects:', err);
    }
  }, []);

  const persistPinnedProjects = useCallback((ids: string[]) => {
    try {
      localStorage.setItem(PINNED_PROJECTS_STORAGE_KEY, JSON.stringify(ids));
    } catch (err) {
      console.warn('Failed to persist pinned projects:', err);
    }
  }, []);

  const handleNewProject = async () => {
    setCreating(true);
    try {
      const initiative = await api.createInitiative(undefined, activeWorkspace?.id);
      router.push(`/initiatives/${initiative.id}?view=overview`);
    } catch (error) {
      console.error('Failed to create project:', error);
      setCreating(false);
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await api.deleteInitiative(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  const handlePermanentDelete = async (id: string) => {
    try {
      await api.permanentlyDeleteInitiative(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (error) {
      console.error('Failed to permanently delete project:', error);
    }
  };

  const handleRestoreProject = async (id: string) => {
    try {
      await api.restoreInitiative(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (error) {
      console.error('Failed to restore project:', error);
    }
  };

  const handleTogglePinProject = useCallback((id: string) => {
    setPinnedProjectIds((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((pinnedId) => pinnedId !== id);
        persistPinnedProjects(next);
        return next;
      }
      if (prev.length >= MAX_PINNED_PROJECTS) {
        return prev;
      }
      const next = [...prev, id];
      persistPinnedProjects(next);
      return next;
    });
  }, [persistPinnedProjects]);

  const pageTitle = isFilesView
    ? 'Workspace files'
    : (isTrashView ? 'Trash' : activeWorkspace?.name ?? 'All Projects');

  const filteredProjects = useMemo(() => projects.filter((p: Initiative) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    const title = (p.title || 'New Project').toLowerCase();
    const sector = (p.sector || '').toLowerCase();
    const desc = (p.project_description || '').toLowerCase();
    return title.includes(q) || sector.includes(q) || desc.includes(q);
  }), [projects, searchQuery]);
  const pinnedProjectSet = useMemo(() => new Set(pinnedProjectIds), [pinnedProjectIds]);
  const pinnedProjects = useMemo(() => filteredProjects
    .filter((p) => pinnedProjectSet.has(p.id))
    .sort((a, b) => (a.title || 'New Project').localeCompare(b.title || 'New Project', undefined, { sensitivity: 'base' })), [filteredProjects, pinnedProjectSet]);
  const unpinnedProjects = useMemo(() => filteredProjects.filter((p) => !pinnedProjectSet.has(p.id)), [filteredProjects, pinnedProjectSet]);
  const displayedProjects = useMemo(
    () => (isTrashView ? filteredProjects : [...pinnedProjects, ...unpinnedProjects]),
    [filteredProjects, isTrashView, pinnedProjects, unpinnedProjects],
  );
  const effectiveError = error || (!activeWorkspace ? workspaceError : null);

  useLayoutEffect(() => {
    const nextPositions = new Map<string, DOMRect>();
    displayedProjects.forEach((project) => {
      const element = cardRefs.current.get(project.id);
      if (element) {
        nextPositions.set(project.id, element.getBoundingClientRect());
      }
    });

    displayedProjects.forEach((project) => {
      const element = cardRefs.current.get(project.id);
      const nextRect = nextPositions.get(project.id);
      const prevRect = prevCardPositionsRef.current.get(project.id);
      if (!element || !nextRect || !prevRect) return;

      const deltaX = prevRect.left - nextRect.left;
      const deltaY = prevRect.top - nextRect.top;
      if (deltaX === 0 && deltaY === 0) return;

      element.style.transition = 'none';
      element.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      requestAnimationFrame(() => {
        element.style.transition = 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)';
        element.style.transform = 'translate(0px, 0px)';
      });
    });

    prevCardPositionsRef.current = nextPositions;
  }, [displayedProjects]);

  return (
    <>
      <ShellPageHeader>
        <div className="px-4 h-full flex items-center relative">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <h1 className="text-[13px] font-medium text-text-primary truncate">{pageTitle}</h1>
          </div>
          {workspaceOptions.length > 0 && (
            <div ref={workspaceSwitcherRef} className="relative ml-auto">
              <button
                type="button"
                onClick={() => {
                  if (workspaceLoading || workspaceSwitching || workspaceOptions.length < 2) return;
                  setWorkspaceSwitcherOpen((open) => !open);
                }}
                disabled={workspaceLoading || workspaceSwitching || workspaceOptions.length < 2}
                className="btn-secondary !py-1.5 !px-3 !rounded-md !text-xs !font-medium !gap-1.5 flex items-center shrink-0"
                aria-label="Switch workspace"
                aria-expanded={workspaceSwitcherOpen}
              >
                Switch
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>
              {workspaceSwitcherOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-divider bg-white py-1 shadow-lg">
                  {workspaceOptions.map((workspace) => {
                    const selected = workspace.id === activeWorkspace?.id;
                    return (
                      <button
                        key={workspace.id}
                        type="button"
                        onClick={() => {
                          setWorkspaceSwitcherOpen(false);
                          void handleWorkspaceSwitch(workspace.id);
                        }}
                        className={`flex h-8 w-full items-center gap-2 px-3 text-left text-xs transition-colors ${
                          selected
                            ? 'bg-surface-subtle text-text-primary'
                            : 'text-text-secondary hover:bg-black/[0.04] hover:text-text-primary'
                        }`}
                      >
                        <span className="w-3.5 shrink-0">
                          {selected ? <Check className="w-3.5 h-3.5" /> : null}
                        </span>
                        <span className="truncate">
                          {workspace.name} · {workspace.workspace_type === 'personal' ? 'Personal' : 'Team'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </ShellPageHeader>

      <div className="flex-1 p-2 pt-0 pl-1 min-h-0">
        <main className="h-full bg-surface rounded-lg shadow-workspace min-h-0 overflow-auto">
          <div className="h-full px-6 py-4 flex flex-col">
            {isFilesView ? (
              <ProjectFilesView
                scope="workspace"
                title="Workspace files"
                description="Shared guidance and reusable context for this workspace."
                materials={workspaceMaterials}
                onDeleteMaterial={deleteWorkspaceFile}
                onUploadFile={uploadWorkspaceFile}
                onImportFromDrive={importWorkspaceFromDrive}
              />
            ) : (
              <>
                <div className="mb-6 flex items-center justify-between gap-4">
                  <div className="relative h-7 flex-1 min-w-0 max-w-2xl">
                    <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                      <Search className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                    </span>
                    <input
                      type="search"
                      placeholder={isTrashView ? 'Search trash' : 'Search projects'}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full h-7 appearance-none leading-none pl-[2.25rem] pr-4 text-xs rounded-lg bg-surface border border-stroke-subtle text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none transition-colors duration-150"
                      aria-label={isTrashView ? 'Search trash' : 'Search projects'}
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setIsTrashView((v) => !v)}
                      className={`btn-secondary !h-7 !text-xs !leading-none !px-2.5 !py-0 !rounded-lg ${isTrashView ? '!border-accent !text-accent' : ''}`}
                    >
                      {isTrashView ? <Undo2 className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
                      {isTrashView ? 'Back to Projects' : 'Trash'}
                    </button>
                    {!isTrashView && (
                      <button
                        onClick={handleNewProject}
                        disabled={creating}
                        className="btn-primary !h-7 !text-xs !leading-none !px-2.5 !py-0 !rounded-lg"
                      >
                        {creating ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Creating...
                          </>
                        ) : (
                          <>
                            <Plus className="w-3 h-3" />
                            New Project
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
                {loading ? (
                  <div className="flex flex-1 items-center justify-center">
                    <PageLoader label="" />
                  </div>
                ) : effectiveError ? (
                  <div className="text-center py-20">
                    <p className="text-text-secondary">{effectiveError}</p>
                    <button
                      onClick={loadProjects}
                      className="btn-secondary mt-4 text-sm"
                    >
                      Try again
                    </button>
                  </div>
                ) : displayedProjects.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 max-w-md mx-auto text-center">
                    <div className={`w-16 h-16 rounded-lg flex items-center justify-center mb-6 ${isTrashView ? 'bg-surface-subtle' : 'bg-accent-wash'}`}>
                      {isTrashView ? (
                        <Trash2 className="w-8 h-8 text-text-tertiary" />
                      ) : (
                        <FolderOpen className="w-8 h-8 text-accent" />
                      )}
                    </div>
                    <h2 className="text-lg font-semibold text-text-primary mb-2">
                      {searchQuery.trim()
                        ? 'No matches'
                        : isTrashView
                          ? 'Trash is empty'
                          : 'No projects yet'}
                    </h2>
                    <p className="text-text-secondary text-sm mb-6">
                      {searchQuery.trim()
                        ? 'Try a different search.'
                        : isTrashView
                          ? 'Projects you delete will appear here.'
                          : 'Create your first project.'}
                    </p>
                    {!isTrashView && !searchQuery.trim() && (
                      <button
                        onClick={handleNewProject}
                        disabled={creating}
                        className="btn-primary"
                      >
                        {creating ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Creating...
                          </>
                        ) : (
                          <>
                            <Plus className="w-4 h-4" />
                            Create Project
                          </>
                        )}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                    {displayedProjects.map((project) => (
                      <div
                        key={project.id}
                        ref={(node) => {
                          if (node) {
                            cardRefs.current.set(project.id, node);
                          } else {
                            cardRefs.current.delete(project.id);
                          }
                        }}
                        className="will-change-transform"
                      >
                        <ProjectCard
                          project={project}
                          onDelete={isTrashView ? handlePermanentDelete : handleDeleteProject}
                          onRestore={isTrashView ? handleRestoreProject : undefined}
                          isTrash={isTrashView}
                          isPinned={pinnedProjectSet.has(project.id)}
                          canPinMore={pinnedProjectSet.has(project.id) || pinnedProjectIds.length < MAX_PINNED_PROJECTS}
                          onTogglePin={handleTogglePinProject}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </>
  );
}

export default function HomePage() {
  return (
    <ProtectedRoute>
      <HomePageContent />
    </ProtectedRoute>
  );
}
