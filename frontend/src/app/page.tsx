'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, FolderOpen, Loader2, Menu, Trash2 } from 'lucide-react';
import { api, Initiative } from '@/lib/api';
import { ProjectCard } from '@/components/projects';
import { SideDrawer, NavItem } from '@/components/ui';

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Initiative[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeNav, setActiveNav] = useState<NavItem>('projects');

  useEffect(() => {
    loadProjects();
  }, [activeNav]);

  const loadProjects = async () => {
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
  };

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

  const handleRestoreProject = async (id: string) => {
    try {
      await api.restoreInitiative(id);
      setProjects(projects.filter(p => p.id !== id));
    } catch (error) {
      console.error('Failed to restore project:', error);
    }
  };

  const handleNavChange = (item: NavItem) => {
    setActiveNav(item);
  };

  const isTrashView = activeNav === 'trash';

  return (
    <main className="min-h-full bg-white">
      {/* Side Drawer */}
      <SideDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        activeItem={activeNav}
        onItemSelect={handleNavChange}
      />

      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsDrawerOpen(true)}
            className="p-2 -ml-2 rounded text-text-secondary hover:text-text-primary hover:bg-surface-subtle transition-colors"
            title="Menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-display font-semibold text-text-primary tracking-tight">
            Wisteria
          </h1>
        </div>
        {!isTrashView && (
          <button
            onClick={handleNewProject}
            disabled={creating}
            className="btn-primary text-sm"
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
      </header>

      {/* Accent divider */}
      <div className="divider-accent" />

      {/* View title */}
      <div className="px-6 pt-6 pb-2">
        <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
          {isTrashView ? (
            <>
              <Trash2 className="w-5 h-5 text-text-tertiary" />
              Trash
            </>
          ) : (
            <>
              <FolderOpen className="w-5 h-5 text-accent" />
              Projects
            </>
          )}
        </h2>
      </div>

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
        ) : projects.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-20 max-w-md mx-auto text-center">
            <div className={`w-16 h-16 rounded-lg flex items-center justify-center mb-6 ${isTrashView ? 'bg-surface-subtle' : 'bg-accent-wash'}`}>
              {isTrashView ? (
                <Trash2 className="w-8 h-8 text-text-tertiary" />
              ) : (
                <FolderOpen className="w-8 h-8 text-accent" />
              )}
            </div>
            <h2 className="text-lg font-semibold text-text-primary mb-2">
              {isTrashView ? 'Trash is empty' : 'No projects yet'}
            </h2>
            <p className="text-text-secondary text-sm mb-6">
              {isTrashView 
                ? 'Projects you delete will appear here.'
                : 'Create your first project to get started with investment memos and due diligence.'}
            </p>
            {!isTrashView && (
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
            {projects.map((project) => (
              <ProjectCard 
                key={project.id} 
                project={project} 
                onDelete={isTrashView ? undefined : handleDeleteProject}
                onRestore={isTrashView ? handleRestoreProject : undefined}
                isTrash={isTrashView}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
