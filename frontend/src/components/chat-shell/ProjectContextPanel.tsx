'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertCircle, HelpCircle, Loader2, MinusCircle } from 'lucide-react';
import { api, type Project, type ProjectHealthDimension, type ProjectHealthStatus, type ProjectShare } from '@/lib/api';
import { CHAT_FLOATING_PANEL_CHROME } from '@/components/ui/chatSidebarLayout';

const MAX_COLLABORATOR_ROWS = 3;

interface CollaboratorEntry {
  id: string;
  label: string;
  roleLabel: string;
  isOwner?: boolean;
}

function buildCollaborators(project: Project, shares: ProjectShare[]): CollaboratorEntry[] {
  const ownerEmail = project.owner_email?.trim() || null;
  const owner: CollaboratorEntry = {
    id: 'owner',
    label: ownerEmail || project.created_by,
    roleLabel: 'Owner',
    isOwner: true,
  };
  const others = shares
    .filter((share) => !ownerEmail || share.user_email !== ownerEmail)
    .map((share) => ({
      id: share.id,
      label: share.user_email || share.user_id || 'Invited',
      roleLabel: share.role === 'editor' ? 'Editor' : 'Viewer',
    }));
  return [owner, ...others];
}

function CollaboratorRow({ label, roleLabel, isOwner = false }: CollaboratorEntry) {
  const initials = (label || '?')[0].toUpperCase();

  return (
    <li className="flex items-center gap-2 py-1 min-h-[1.75rem]">
      <div
        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
          isOwner ? 'bg-accent/10' : 'bg-surface-subtle'
        }`}
      >
        <span className={`text-[9px] font-semibold ${isOwner ? 'text-accent' : 'text-text-secondary'}`}>
          {initials}
        </span>
      </div>
      <span className="min-w-0 flex-1 text-[11px] text-text-primary truncate">{label}</span>
      <span className="text-[9px] font-medium text-text-tertiary uppercase tracking-wide shrink-0">
        {roleLabel}
      </span>
    </li>
  );
}

const STATUS_META: Record<ProjectHealthStatus, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  green: { label: 'On track', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
  yellow: { label: 'Needs attention', className: 'bg-amber-50 text-amber-700 border-amber-200', Icon: AlertCircle },
  red: { label: 'At risk', className: 'bg-red-50 text-red-700 border-red-200', Icon: MinusCircle },
  unknown: { label: 'Unknown', className: 'bg-surface-subtle text-text-secondary border-stroke-subtle', Icon: HelpCircle },
};

interface ProjectContextPanelProps {
  project: Project | null;
  /** Floating card in stack vs docked column */
  variant?: 'docked' | 'floating' | 'stacked';
  refreshKey?: number;
}

export function ProjectContextPanel({
  project,
  variant = 'docked',
  refreshKey = 0,
}: ProjectContextPanelProps) {
  const [healthDimensions, setHealthDimensions] = useState<ProjectHealthDimension[]>([]);
  const [shares, setShares] = useState<ProjectShare[]>([]);
  const [collaboratorsLoading, setCollaboratorsLoading] = useState(false);

  useEffect(() => {
    if (!project?.id) {
      setHealthDimensions([]);
      return;
    }
    api
      .getProjectHealth(project.id)
      .then((res) => setHealthDimensions(res.dimensions.slice(0, 4)))
      .catch(() => setHealthDimensions([]));
  }, [project?.id, refreshKey]);

  useEffect(() => {
    if (!project?.id) {
      setShares([]);
      return;
    }
    setCollaboratorsLoading(true);
    api
      .getShares(project.id)
      .then((data) => setShares(data))
      .catch(() => setShares([]))
      .finally(() => setCollaboratorsLoading(false));
  }, [project?.id, refreshKey]);

  const collaborators = useMemo(
    () => (project ? buildCollaborators(project, shares) : []),
    [project, shares],
  );
  const visibleCollaborators = collaborators.slice(0, MAX_COLLABORATOR_ROWS);
  const hiddenCollaboratorCount = Math.max(0, collaborators.length - MAX_COLLABORATOR_ROWS);

  if (!project) return null;

  const panelClass =
    variant === 'floating'
      ? `absolute z-20 right-3 top-3 w-[min(22rem,34vw)] max-h-[50vh] flex flex-col min-h-0 overflow-hidden ${CHAT_FLOATING_PANEL_CHROME}`
      : variant === 'stacked'
        ? `flex flex-col min-h-0 max-h-[45vh] overflow-hidden shrink-0 ${CHAT_FLOATING_PANEL_CHROME}`
        : 'w-[min(22rem,34vw)] shrink-0 border-l border-divider bg-surface flex flex-col min-h-0';

  return (
    <aside className={panelClass}>
      <div className="px-4 py-3 shrink-0">
        <h2 className="text-sm font-semibold text-text-primary truncate">Overview</h2>
        {project.subject && (
          <p className="mt-1 text-xs text-text-secondary line-clamp-3">{project.subject}</p>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">
            Status
          </h3>
          {healthDimensions.length === 0 ? (
            <p className="text-xs text-text-secondary">Run a refresh from project health to populate rubric scores.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {healthDimensions.map((dim) => {
                const meta = STATUS_META[dim.effective_status];
                const Icon = meta.Icon;
                return (
                  <li
                    key={dim.dimension_id}
                    title={dim.rationale}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-medium ${meta.className}`}
                  >
                    <Icon className="w-3 h-3" />
                    {dim.label}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mt-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">
            Collaborators
          </h3>
          {collaboratorsLoading ? (
            <div className="flex items-center gap-2 text-xs text-text-tertiary">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading…
            </div>
          ) : (
            <ul>
              {visibleCollaborators.map((collaborator) => (
                <CollaboratorRow key={collaborator.id} {...collaborator} />
              ))}
            </ul>
          )}
          {!collaboratorsLoading && hiddenCollaboratorCount > 0 && (
            <p className="mt-1 pl-3.5 text-[10px] text-text-tertiary">
              +{hiddenCollaboratorCount} more
            </p>
          )}
        </section>
      </div>
    </aside>
  );
}
