'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, FolderOpen, Loader2, Trash2, Search } from 'lucide-react';
import { api, Initiative } from '@/lib/api';
import { ProjectCard } from '@/components/projects';
import { SideDrawer, SideDrawerHeader, NavItem } from '@/components/ui';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/auth';
import { useChatStore } from '@/stores/chatStore';

function HomePageContent() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [projects, setProjects] = useState<Initiative[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<NavItem>('projects');
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
      // Debug: Log the timestamps
      console.log('Projects with timestamps:', data.map(p => ({
        title: p.title,
        created_at: p.created_at,
        updated_at: p.updated_at,
      })));
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
    // Confirmation is handled in ProjectCard component
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
    if (item === 'chat') {
      useChatStore.getState().reset();
      router.push('/chat');
      return;
    }
    setActiveNav(item);
  };

  const isTrashView = activeNav === 'trash';

  const filteredProjects = projects.filter((p: Initiative) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    const title = (p.title || 'Untitled').toLowerCase();
    const sector = (p.sector || '').toLowerCase();
    const desc = (p.project_description || '').toLowerCase();
    return title.includes(q) || sector.includes(q) || desc.includes(q);
  });

  return (
    <div className="min-h-screen h-screen flex flex-col">
      {/* Shared header row - one continuous line below */}
      <div className="flex h-[72px] shrink-0">
        <SideDrawerHeader />
        <header className="flex-1 px-6 flex items-center justify-between gap-4 bg-white">
          <h1 className="text-xl font-display font-semibold text-text-primary tracking-tight shrink-0">
            Nitrogen AI
          </h1>
          <div className="flex items-center gap-3 flex-1 max-w-xl justify-end">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none shrink-0" />
              <input
                type="search"
                placeholder={isTrashView ? 'Search trash' : 'Search projects'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-10 pl-[2.75rem] pr-4 py-2.5 text-sm rounded-[20px] bg-white border border-stroke-subtle text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none transition-colors duration-150"
                aria-label={isTrashView ? 'Search trash' : 'Search projects'}
              />
            </div>
            {!isTrashView && (
              <button
                onClick={handleNewProject}
                disabled={creating}
                className="btn-primary text-sm shrink-0 h-10"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    New Project
                  </>
                )}
              </button>
            )}
          </div>
        </header>
      </div>

      {/* Single full-width accent divider */}
      <div className="divider-accent shrink-0" />

      {/* Content row: sidebar nav + main */}
      <div className="flex flex-1 min-h-0">
        <SideDrawer
          activeItem={activeNav}
          onItemSelect={handleNavChange}
          includeHeader={false}
          onSignOut={handleSignOut}
          userEmail={user?.email}
        />
        <main className="flex-1 bg-white min-h-0 overflow-auto">
      {/* Content */}
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
          /* Empty state or no search matches */
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
          /* Project grid */
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
  );
}

export default function HomePage() {
  return (
    <ProtectedRoute>
      <HomePageContent />
    </ProtectedRoute>
  );
}
