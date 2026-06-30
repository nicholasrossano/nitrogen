'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Scale, Search, X, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { Project } from '@/lib/api';
import { CHAT_FLOATING_PANEL_SHADOW } from '@/components/ui/chatSidebarLayout';

export interface CompareProject {
  id: string;
  title: string;
}

interface CompareProjectPickerProps {
  /** The current project ID (excluded from the list) */
  currentProjectId: string;
  selected: CompareProject | null;
  onSelect: (project: CompareProject | null) => void;
  disabled?: boolean;
}

export function CompareProjectPicker({
  currentProjectId,
  selected,
  onSelect,
  disabled = false,
}: CompareProjectPickerProps) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listProjects(50, 0, false);
      setProjects(data.filter((p) => p.id !== currentProjectId));
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [currentProjectId]);

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: 'fixed',
      left: rect.left,
      top: rect.top - 8,
      transform: 'translateY(-100%)',
      width: 280,
      zIndex: 9999,
    });
  };

  const handleOpen = () => {
    updatePosition();
    setOpen((v) => !v);
    if (!open) {
      fetchProjects();
      setSearch('');
    }
  };

  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = () => updatePosition();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open]);

  const filtered = projects.filter(
    (p) => (p.title ?? 'Untitled').toLowerCase().includes(search.toLowerCase()),
  );

  const handleSelect = (project: Project) => {
    onSelect({ id: project.id, title: project.title ?? 'Untitled' });
    setOpen(false);
  };

  const dropdown = open && (
    <div
      ref={dropdownRef}
      style={dropdownStyle}
      className={`rounded-xl border border-stroke-subtle bg-white overflow-hidden ${CHAT_FLOATING_PANEL_SHADOW}`}
    >
      <div className="px-3 pt-2.5 pb-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
          Compare with project
        </p>
      </div>
      <div className="px-2.5 pb-1.5">
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-surface-subtle border border-stroke-subtle">
          <Search className="w-3 h-3 text-text-tertiary shrink-0" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="flex-1 text-xs bg-transparent text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
        </div>
      </div>
      <div className="pb-1.5 max-h-48 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 text-text-tertiary animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-text-tertiary text-center py-3">
            {search ? 'No projects found' : 'No other projects'}
          </p>
        ) : (
          filtered.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => handleSelect(project)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors duration-100 hover:bg-surface-subtle"
            >
              <span className="text-xs font-medium text-text-primary truncate">
                {project.title ?? 'Untitled'}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleOpen}
        title={selected ? `Compare against ${selected.title}` : 'Compare against another project'}
        className={`h-6 inline-flex items-center gap-1.5 px-2 rounded-md border text-[11px] font-medium transition-colors duration-150 disabled:opacity-40 disabled:cursor-default ${
          selected
            ? 'border-accent/30 bg-accent/10 text-accent enabled:hover:bg-accent/20'
            : 'border-stroke-subtle text-text-tertiary enabled:hover:text-text-secondary enabled:hover:border-stroke-muted enabled:hover:bg-surface-subtle'
        }`}
      >
        <Scale className="w-3 h-3 shrink-0" />
        <span className="truncate max-w-[14rem]">
          Compare against...
        </span>
      </button>
      {typeof document !== 'undefined' && dropdown
        ? createPortal(dropdown, document.body)
        : null}
    </>
  );
}

export function CompareChip({
  project,
  onRemove,
}: {
  project: CompareProject;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/10 border border-accent/20 text-[11px] font-medium text-accent leading-none">
      <span className="truncate max-w-[20rem]">Compare against {project.title}</span>
      <button
        type="button"
        onClick={onRemove}
        className="hover:opacity-60 transition-opacity"
        aria-label={`Remove comparison with ${project.title}`}
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );
}
