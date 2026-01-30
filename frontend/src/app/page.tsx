'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, FolderOpen, Loader2 } from 'lucide-react';
import { api, Initiative } from '@/lib/api';
import { ProjectCard } from '@/components/projects';

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Initiative[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const data = await api.listInitiatives();
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
    if (!confirm('Are you sure you want to delete this project? This cannot be undone.')) {
      return;
    }
    
    try {
      await api.deleteInitiative(id);
      setProjects(projects.filter(p => p.id !== id));
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  return (
    <main className="min-h-full bg-white">
      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-display font-semibold text-text-primary tracking-tight">
          Wisterion
        </h1>
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
      </header>

      {/* Accent divider */}
      <div className="divider-accent" />

      {/* Content */}
      <div className="px-6 py-8">
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
            <div className="w-16 h-16 bg-accent-wash rounded-lg flex items-center justify-center mb-6">
              <FolderOpen className="w-8 h-8 text-accent" />
            </div>
            <h2 className="text-lg font-semibold text-text-primary mb-2">
              No projects yet
            </h2>
            <p className="text-text-secondary text-sm mb-6">
              Create your first project to get started with investment memos and due diligence.
            </p>
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
          </div>
        ) : (
          /* Project grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {projects.map((project) => (
              <ProjectCard 
                key={project.id} 
                project={project} 
                onDelete={handleDeleteProject}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
