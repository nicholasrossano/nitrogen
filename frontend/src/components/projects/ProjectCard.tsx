'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { Layers, Clock, Trash2, RotateCcw, Users, Pin } from 'lucide-react';
import { Initiative, api } from '@/lib/api';
import { IconPickerButton } from '@/components/ui/IconPickerButton';

const ROLE_LABEL: Record<string, string> = {
  editor: 'Editor',
  viewer: 'Viewer',
  client: 'Client',
};

interface ProjectCardProps {
  project: Initiative;
  onDelete?: (id: string) => void;
  onRestore?: (id: string) => void;
  isTrash?: boolean;
  isPinned?: boolean;
  canPinMore?: boolean;
  onTogglePin?: (id: string) => void;
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

function getGeneratedAssessmentCount(project: Initiative): number {
  if (typeof project.generated_assessments_count === 'number') {
    return project.generated_assessments_count;
  }
  if (!project.deliverables) return 0;
  return Object.keys(project.deliverables).length;
}

export function ProjectCard({
  project,
  onDelete,
  onRestore,
  isTrash = false,
  isPinned = false,
  canPinMore = true,
  onTogglePin,
}: ProjectCardProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [currentIcon, setCurrentIcon] = useState(project.icon);

  const title = project.title || 'New Project';
  const generatedAssessmentCount = getGeneratedAssessmentCount(project);
  const lastModified = formatRelativeTime(project.updated_at || project.created_at);
  const isShared = !!project.shared_role;
  const canDelete = !isShared;

  const handlePickIcon = useCallback(async (name: string) => {
    setCurrentIcon(name);
    try {
      await api.updateInitiative(project.id, { icon: name });
    } catch {
      setCurrentIcon(project.icon);
    }
  }, [project.id, project.icon]);

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // For trash view, show confirmation for permanent delete
    if (isTrash) {
      setShowDeleteConfirm(true);
    } else if (onDelete) {
      onDelete(project.id);
    }
  };

  const handleConfirmDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onDelete) {
      onDelete(project.id);
    }
    setShowDeleteConfirm(false);
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowDeleteConfirm(false);
  };

  const handleRestore = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onRestore) {
      onRestore(project.id);
    }
  };

  const handleTogglePin = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onTogglePin) {
      onTogglePin(project.id);
    }
  };

  const CardWrapper = isTrash ? 'div' : Link;
  const cardProps = isTrash ? {} : { href: `/initiatives/${project.id}` };

  return (
    <CardWrapper {...cardProps as any}>
      <div className={`p-5 h-full flex flex-col relative group border border-black/[0.04] ${isTrash ? 'card cursor-default' : 'card-interactive'}`}>
        {/* Action buttons */}
        {isTrash ? (
          <>
            {/* Restore button (left of trash button in top right) */}
            {onRestore && (
              <button
                onClick={handleRestore}
                className="project-action-btn project-action-btn-success absolute top-2 right-11 p-1.5 rounded opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-indicator-green transition-opacity"
                title="Restore project"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
            {/* Permanent delete button (far right) */}
            {onDelete && (
              <button
                onClick={handleDelete}
                className="project-action-btn project-action-btn-danger absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-indicator-orange transition-opacity"
                title="Permanently delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </>
        ) : (
          <>
            {canDelete && onDelete && (
              <button
                onClick={handleDelete}
                className="project-action-btn project-action-btn-danger absolute top-10 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 text-text-tertiary enabled:hover:text-indicator-orange transition-opacity"
                title="Delete project"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            {onTogglePin && (
              <button
                onClick={handleTogglePin}
                disabled={!isPinned && !canPinMore}
                className={`project-action-btn project-action-btn-accent absolute top-2 right-2 p-1.5 rounded transition-opacity transition-colors ${
                  isPinned
                    ? 'opacity-100 text-accent'
                    : 'opacity-0 group-hover:opacity-100 text-text-tertiary enabled:hover:text-accent'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                title={isPinned ? 'Unpin project' : canPinMore ? 'Pin project' : 'Pin limit reached (max 3)'}
              >
                <Pin className={`w-4 h-4 ${isPinned ? 'text-accent fill-current' : ''}`} />
              </button>
            )}
          </>
        )}

        {/* Icon and title */}
        <div className="flex items-center gap-3 mb-3 pr-6">
          <div className="relative flex-shrink-0">
            <IconPickerButton
              iconName={currentIcon}
              onPick={handlePickIcon}
              disabled={isTrash}
              buttonClassName={`w-10 h-10 rounded flex items-center justify-center transition-colors ${
                isTrash
                  ? 'bg-surface-subtle'
                  : 'bg-accent-wash hover:bg-accent/15'
              }`}
              iconClassName={`w-5 h-5 ${isTrash ? 'text-text-tertiary' : 'text-accent'}`}
            />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold text-sm line-clamp-2 ${isTrash ? 'text-text-secondary' : 'text-text-primary'}`}>
              {title}
            </h3>
            {isShared && (
              <div className="flex items-center gap-1.5 mt-1">
                <Users className="w-3 h-3 text-text-tertiary flex-shrink-0" />
                <span className="text-[10px] text-text-tertiary truncate">
                  {ROLE_LABEL[project.shared_role!] || project.shared_role}
                  {project.owner_email && <> &middot; {project.owner_email}</>}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1" />

        {/* Stats row */}
        <div className="-mx-5 px-5 flex items-center justify-between text-xs text-text-tertiary pt-4 mt-1">
          <div className="flex items-center gap-3">
            {generatedAssessmentCount > 0 && (
              <span className="flex items-center gap-1">
                <Layers className="w-3.5 h-3.5" />
                {generatedAssessmentCount} assessment{generatedAssessmentCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {lastModified}
          </span>
        </div>

        {/* Confirmation overlay */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 bg-white flex flex-col items-center justify-center gap-3 p-5 rounded border-1 border-divider">
            <div className="text-center">
              <p className="text-sm font-semibold text-text-primary">Permanently delete?</p>
            </div>
            <div className="flex gap-2 w-full">
              <button
                onClick={handleCancelDelete}
                className="btn-secondary flex-1 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="btn-danger flex-1 py-2 text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </CardWrapper>
  );
}
