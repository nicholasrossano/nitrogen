'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { FileText, Clock, Trash2, RotateCcw, Users } from 'lucide-react';
import { Initiative, api } from '@/lib/api';
import { getIconByName, ICON_NAMES } from '@/lib/icons';

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
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  // Debug: Log first 3 calculations
  if (Math.random() < 0.1) { // Only log occasionally to avoid spam
    console.log('Time calc:', {
      dateString,
      parsedDate: date.toISOString(),
      now: now.toISOString(),
      diffMs,
      diffMins,
      diffHours,
      diffDays
    });
  }

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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);
  const [currentIcon, setCurrentIcon] = useState(project.icon);
  const iconBtnRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const title = project.title || 'New Project';
  const outputCount = getOutputCount(project);
  const lastModified = formatRelativeTime(project.updated_at || project.created_at);
  const IconComponent = getIconByName(currentIcon);
  const isShared = !!project.shared_role;
  const canDelete = !isShared;

  const handleIconClick = (e: React.MouseEvent) => {
    if (isTrash) return;
    e.preventDefault();
    e.stopPropagation();
    if (iconPickerOpen) {
      setIconPickerOpen(false);
      return;
    }
    const rect = iconBtnRef.current?.getBoundingClientRect();
    if (rect) {
      setPickerPos({ top: rect.bottom + window.scrollY + 6, left: rect.left + window.scrollX });
    }
    setIconPickerOpen(true);
  };

  const handlePickIcon = useCallback(async (e: React.MouseEvent, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCurrentIcon(name);
    setIconPickerOpen(false);
    try {
      await api.updateInitiative(project.id, { icon: name });
    } catch {
      setCurrentIcon(project.icon);
    }
  }, [project.id, project.icon]);

  useEffect(() => {
    if (!iconPickerOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (
        pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
        iconBtnRef.current && !iconBtnRef.current.contains(e.target as Node)
      ) {
        setIconPickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [iconPickerOpen]);

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
          canDelete && onDelete && (
            <button
              onClick={handleDelete}
              className="project-action-btn project-action-btn-danger absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-indicator-orange transition-opacity"
              title="Delete project"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )
        )}

        {/* Icon and title */}
        <div className="flex items-center gap-3 mb-3 pr-6">
          <div className="relative flex-shrink-0">
            <button
              ref={iconBtnRef}
              type="button"
              onClick={handleIconClick}
              className={`w-10 h-10 rounded flex items-center justify-center transition-colors ${
                isTrash
                  ? 'bg-surface-subtle cursor-default'
                  : 'bg-accent-wash hover:bg-accent/15 cursor-pointer'
              }`}
              title={isTrash ? undefined : 'Change icon'}
            >
              <IconComponent className={`w-5 h-5 ${isTrash ? 'text-text-tertiary' : 'text-accent'}`} />
            </button>

            {/* Icon picker — portalled to body so it escapes card stacking context */}
            {iconPickerOpen && pickerPos && typeof document !== 'undefined' && createPortal(
              <div
                ref={pickerRef}
                style={{ position: 'absolute', top: pickerPos.top, left: pickerPos.left }}
                className="z-[9999] bg-surface border border-stroke-subtle rounded-lg shadow-lg p-2 w-[224px]"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              >
                <div className="grid grid-cols-7 gap-0.5 max-h-48 overflow-y-auto overflow-x-hidden">
                  {ICON_NAMES.map((name) => {
                    const Icon = getIconByName(name);
                    const isActive = name === currentIcon;
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={(e) => handlePickIcon(e, name)}
                        className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                          isActive
                            ? 'bg-accent text-white'
                            : 'text-text-secondary hover:bg-accent/10 hover:text-accent'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </button>
                    );
                  })}
                </div>
              </div>,
              document.body
            )}
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
        <div className="-mx-5 px-5 flex items-center justify-between text-xs text-text-tertiary pt-4 mt-1 border-t-[1.5px] border-black/[0.04]">
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

        {/* Confirmation overlay */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 bg-white flex flex-col items-center justify-center gap-3 p-5 rounded border-1 border-divider">
            <div className="text-center">
              <p className="text-sm font-semibold text-text-primary mb-1">Permanently delete?</p>
              <p className="text-xs text-text-secondary">This action cannot be undone.</p>
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
