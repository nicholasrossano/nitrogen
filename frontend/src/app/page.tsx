'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, FolderOpen, Loader2, Trash2, Search } from 'lucide-react';
import { api, Initiative } from '@/lib/api';
import { ProjectCard } from '@/components/projects';
import { SideDrawer, NavItem } from '@/components/ui';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/auth';

function HomePageContent() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [projects, setProjects] = useState<Initiative[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<NavItem>('home');
  const [searchQuery, setSearchQuery] = useState('');

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const isTrash = activeNav === 'trash';
      const data = await api.listInitiatives(20, 0, isTrash);
      setProjects(data);
    } catch (err) {
      setError('Failed to load projects');
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }, [activeNav]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleNewProject = async () => {
    setCreating(true);
    try {
      const initiative = await api.createInitiative();
      router.push(`/initiatives/${initiative.id}`);
    } catch (error) {
      console.error('Failed to create project:', error);
      setCreating(false);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm('Are you sure you want to move this project to trash?')) {
      return;
    }
    
    try {
      await api.deleteInitiative(id);
      setProjects(projects.filter(p => p.id !== id));
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  const handlePermanentDelete = async (id: string) => {
    try {
      await api.permanentlyDeleteInitiative(id);
      setProjects(projects.filter(p => p.id !== id));
    } catch (error) {
      console.error('Failed to permanently delete project:', error);
    }
  };

  const handleRestoreProject = async (id: string) => {
    try {
      await api.restoreInitiative(id);
      setProjects(projects.filter(p => p.id !== id));
    } catch (error) {
      console.error('Failed to restore project:', error);
    }
  };

  const handleNavChange = (item: NavItem) => {
    if (item === 'compare') {
      router.push('/compare');
      return;
    }
    setActiveNav(item);
  };

  const isTrashView = activeNav === 'trash';

  const filteredProjects = projects.filter((p: Initiative) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    const title = (p.title || 'New Project').toLowerCase();
    const sector = (p.sector || '').toLowerCase();
    const desc = (p.project_description || '').toLowerCase();
    return title.includes(q) || sector.includes(q) || desc.includes(q);
  });

  return (
    <div className="min-h-screen h-screen flex flex-col bg-background">
      {/* Header row — shell chrome */}
      <header className="shrink-0 h-14 px-4 flex items-center justify-end gap-3">
        <div className="h-full flex items-center gap-3 flex-1 max-w-xl justify-end">
          <div className="relative h-[36px] flex-1 min-w-0">
            <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <Search className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
            </span>
            <input
              type="search"
              placeholder={isTrashView ? 'Search trash' : 'Search projects'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-[36px] appearance-none leading-none pl-[2.25rem] pr-4 text-xs rounded-[20px] bg-surface border border-stroke-subtle text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none transition-colors duration-150"
              aria-label={isTrashView ? 'Search trash' : 'Search projects'}
            />
          </div>
          {!isTrashView && (
            <>
              <button
                onClick={handleNewProject}
                disabled={creating}
                className="btn-primary shrink-0 !h-[36px] !text-xs !leading-none !px-4 !py-0"
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
            </>
          )}
        </div>
      </header>

      {/* Content row: sidebar rail + inset workspace */}
      <div className="flex flex-1 min-h-0">
        <SideDrawer
          variant="home"
          activeItem={activeNav}
          onItemSelect={handleNavChange}
          onSignOut={handleSignOut}
          userEmail={user?.email}
        />
        <div className="flex-1 p-2 pt-0 pl-1 min-h-0">
          <main className="h-full bg-surface rounded-lg shadow-workspace min-h-0 overflow-auto">
            <div className="px-6 py-4">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 text-accent animate-spin" />
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
            ) : filteredProjects.length === 0 ? (
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
                      : 'Create your first project to get started with investment memos and due diligence.'}
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
                {filteredProjects.map((project) => (
                  <ProjectCard 
                    key={project.id} 
                    project={project} 
                    onDelete={isTrashView ? handlePermanentDelete : handleDeleteProject}
                    onRestore={isTrashView ? handleRestoreProject : undefined}
                    isTrash={isTrashView}
                  />
                ))}
              </div>
            )}
          </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <ProtectedRoute>
      <HomePageContent />
    </ProtectedRoute>
  );
}
