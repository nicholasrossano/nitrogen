'use client';

import Link from 'next/link';
import { FileText, FolderOpen, Clock, Trash2 } from 'lucide-react';
import { Initiative } from '@/lib/api';

interface ProjectCardProps {
  project: Initiative;
  onDelete?: (id: string) => void;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

function getOutputCount(project: Initiative): number {
  if (!project.deliverables) return 0;
  return Object.keys(project.deliverables).length;
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const title = project.title || project.project_description?.slice(0, 50) || 'Untitled Project';
  const outputCount = getOutputCount(project);
  const lastModified = formatRelativeTime(project.updated_at || project.created_at);

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onDelete) {
      onDelete(project.id);
    }
  };

  return (
    <Link href={`/initiatives/${project.id}`}>
      <div className="card p-5 hover:border-stroke-accent transition-colors duration-150 cursor-pointer h-full flex flex-col relative group">
        {/* Delete button */}
        {onDelete && (
          <button
            onClick={handleDelete}
            className="absolute top-3 right-3 p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-indicator-orange/10 text-text-tertiary hover:text-indicator-orange transition-all"
            title="Delete project"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        {/* Icon and title */}
        <div className="flex items-start gap-3 mb-3 pr-6">
          <div className="w-10 h-10 bg-accent-wash rounded flex items-center justify-center flex-shrink-0">
            <FolderOpen className="w-5 h-5 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-text-primary text-sm truncate">
              {title}
            </h3>
          </div>
        </div>

        {/* Description preview */}
        {project.project_description && (
          <p className="text-xs text-text-secondary line-clamp-2 mb-4 flex-1">
            {project.project_description}
          </p>
        )}
        {!project.project_description && <div className="flex-1" />}

        {/* Stats row */}
        <div className="flex items-center justify-between text-xs text-text-tertiary pt-3 border-t border-divider">
          <div className="flex items-center gap-3">
            {outputCount > 0 && (
              <span className="flex items-center gap-1">
                <FileText className="w-3.5 h-3.5" />
                {outputCount} output{outputCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {lastModified}
          </span>
        </div>
      </div>
    </Link>
  );
}
