'use client';

import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, FolderOpen, Loader2, Trash2, Undo2, Search } from 'lucide-react';
import { api, Initiative } from '@/lib/api';
import { ProjectCard } from '@/components/projects';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { PageLoader } from '@/components/ui/PageLoader';
import { ShellPageHeader } from '@/components/ui';

const PINNED_PROJECTS_STORAGE_KEY = 'nitrogen-pinned-project-ids';
const MAX_PINNED_PROJECTS = 3;

function HomePageContent() {
  const router = useRouter();
  const [projects, setProjects] = useState<Initiative[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTrashView, setIsTrashView] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pinnedProjectIds, setPinnedProjectIds] = useState<string[]>([]);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevCardPositionsRef = useRef<Map<string, DOMRect>>(new Map());

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listInitiatives(20, 0, isTrashView);
      setProjects(data);
    } catch (err) {
      setError('Failed to load projects');
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }, [isTrashView]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

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
      const initiative = await api.createInitiative();
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

  const pageTitle = isTrashView ? 'Trash' : 'All Projects';

  const filteredProjects = projects.filter((p: Initiative) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    const title = (p.title || 'New Project').toLowerCase();
    const sector = (p.sector || '').toLowerCase();
    const desc = (p.project_description || '').toLowerCase();
    return title.includes(q) || sector.includes(q) || desc.includes(q);
  });
  const pinnedProjectSet = new Set(pinnedProjectIds);
  const pinnedProjects = filteredProjects
    .filter((p) => pinnedProjectSet.has(p.id))
    .sort((a, b) => (a.title || 'New Project').localeCompare(b.title || 'New Project', undefined, { sensitivity: 'base' }));
  const unpinnedProjects = filteredProjects.filter((p) => !pinnedProjectSet.has(p.id));
  const displayedProjects = isTrashView ? filteredProjects : [...pinnedProjects, ...unpinnedProjects];

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
        </div>
      </ShellPageHeader>

      <div className="flex-1 p-2 pt-0 pl-1 min-h-0">
        <main className="h-full bg-surface rounded-lg shadow-workspace min-h-0 overflow-auto">
          <div className="h-full px-6 py-4 flex flex-col">
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
          ) : error ? (
            <div className="text-center py-20">
              <p className="text-text-secondary">{error}</p>
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
