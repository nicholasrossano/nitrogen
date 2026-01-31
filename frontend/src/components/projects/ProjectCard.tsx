'use client';

import Link from 'next/link';
import { FileText, FolderOpen, Clock, Trash2, RotateCcw } from 'lucide-react';
import { Initiative } from '@/lib/api';

interface ProjectCardProps {
  project: Initiative;
  onDelete?: (id: string) => void;
  onRestore?: (id: string) => void;
  isTrash?: boolean;
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

export function ProjectCard({ project, onDelete, onRestore, isTrash = false }: ProjectCardProps) {
  const title = project.title || 'Untitled';
  const outputCount = getOutputCount(project);
  const lastModified = formatRelativeTime(project.updated_at || project.created_at);

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onDelete) {
      onDelete(project.id);
    }
  };

  const handleRestore = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onRestore) {
      onRestore(project.id);
    }
  };

  const CardWrapper = isTrash ? 'div' : Link;
  const cardProps = isTrash ? {} : { href: `/initiatives/${project.id}` };

  return (
    <CardWrapper {...cardProps as any}>
      <div className={`p-5 h-full flex flex-col relative group ${isTrash ? 'card cursor-default' : 'card-interactive'}`}>
        {/* Action button */}
        {isTrash ? (
          onRestore && (
            <button
              onClick={handleRestore}
              className="absolute top-3 right-3 p-1.5 rounded opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-indicator-green hover:bg-indicator-green/10 transition-all"
              title="Restore project"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )
        ) : (
          onDelete && (
            <button
              onClick={handleDelete}
              className="absolute top-3 right-3 p-1.5 rounded opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-indicator-orange hover:bg-indicator-orange/10 transition-all"
              title="Delete project"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )
        )}

        {/* Icon and title */}
        <div className="flex items-start gap-3 mb-3 pr-6">
          <div className={`w-10 h-10 rounded flex items-center justify-center flex-shrink-0 ${isTrash ? 'bg-surface-subtle' : 'bg-accent-wash'}`}>
            <FolderOpen className={`w-5 h-5 ${isTrash ? 'text-text-tertiary' : 'text-accent'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold text-sm truncate ${isTrash ? 'text-text-secondary' : 'text-text-primary'}`}>
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
        <div className="-mx-5 px-5 flex items-center justify-between text-xs text-text-tertiary pt-3 border-t border-divider">
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
    </CardWrapper>
  );
}
