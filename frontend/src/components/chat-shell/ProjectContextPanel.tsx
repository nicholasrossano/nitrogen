'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertCircle, HelpCircle, ExternalLink, Loader2, MinusCircle } from 'lucide-react';
import { api, type Project, type ProjectHealthDimension, type ProjectHealthStatus, type ProjectShare } from '@/lib/api';
import { CHAT_FLOATING_PANEL_CHROME } from '@/components/ui/chatSidebarLayout';
import { buildCollaborators, CollaboratorRow } from '@/components/chat-shell/projectContextCollaborators';
import { getCached, swrFetch, swrKeys } from '@/lib/swrCache';
import { useProjectStore } from '@/stores/projectStore';

const MAX_COLLABORATOR_ROWS = 3;

const STATUS_META: Record<ProjectHealthStatus, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  green: { label: 'On track', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
  yellow: { label: 'Needs attention', className: 'bg-amber-50 text-amber-700 border-amber-200', Icon: AlertCircle },
  red: { label: 'At risk', className: 'bg-red-50 text-red-700 border-red-200', Icon: MinusCircle },
  unknown: { label: 'Unknown', className: 'bg-surface-subtle text-text-secondary border-stroke-subtle', Icon: HelpCircle },
};

interface ProjectContextPanelProps {
  project: Project | null;
  /** When `project` is briefly null after a store wipe, still resolve Overview by id. */
  projectId?: string | null;
  /** Floating card in stack vs docked column */
  variant?: 'docked' | 'floating' | 'stacked';
  refreshKey?: number;
  onViewAll?: () => void;
}

export function ProjectContextPanel({
  project,
  projectId = null,
  variant = 'docked',
  refreshKey = 0,
  onViewAll,
}: ProjectContextPanelProps) {
  const resolvedId = project?.id ?? projectId ?? null;
  const storeProject = useProjectStore((s) => {
    if (!resolvedId) return null;
    if (s.project?.id === resolvedId) return s.project;
    return s.projectsById[resolvedId] ?? null;
  });
  const resolvedProject = project?.id === resolvedId ? project : storeProject;

  const [healthDimensions, setHealthDimensions] = useState<ProjectHealthDimension[]>([]);
  const [shares, setShares] = useState<ProjectShare[]>([]);
  const [collaboratorsLoading, setCollaboratorsLoading] = useState(false);

  // Re-hydrate the shared project store when Overview would otherwise vanish.
  useEffect(() => {
    if (!resolvedId) return;
    if (resolvedProject?.id === resolvedId) return;
    if (useProjectStore.getState().loading) return;
    void useProjectStore.getState().loadProject(resolvedId);
  }, [resolvedId, resolvedProject?.id, refreshKey]);

  useEffect(() => {
    if (!resolvedProject?.id) {
      setHealthDimensions([]);
      return;
    }
    const key = swrKeys.health(resolvedProject.id);
    const cached = getCached<ProjectHealthDimension[]>(key);
    if (cached) setHealthDimensions(cached.slice(0, 4));

    let cancelled = false;
    void swrFetch(key, async () => {
      const res = await api.getProjectHealth(resolvedProject.id);
      return res.dimensions;
    }, { force: refreshKey > 0 })
      .then(({ data }) => {
        if (!cancelled) setHealthDimensions(data.slice(0, 4));
      })
      .catch(() => {
        if (!cancelled && !cached) setHealthDimensions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [resolvedProject?.id, refreshKey]);

  useEffect(() => {
    if (!resolvedProject?.id) {
      setShares([]);
      return;
    }
    const key = swrKeys.shares(resolvedProject.id);
    const cached = getCached<ProjectShare[]>(key);
    if (cached) {
      setShares(cached);
      setCollaboratorsLoading(false);
    } else {
      setCollaboratorsLoading(true);
    }

    let cancelled = false;
    void swrFetch(key, () => api.getShares(resolvedProject.id), { force: refreshKey > 0 })
      .then(({ data }) => {
        if (!cancelled) setShares(data);
      })
      .catch(() => {
        if (!cancelled && !cached) setShares([]);
      })
      .finally(() => {
        if (!cancelled) setCollaboratorsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [resolvedProject?.id, refreshKey]);

  const collaborators = useMemo(
    () => (resolvedProject ? buildCollaborators(resolvedProject, shares) : []),
    [resolvedProject, shares],
  );
  const visibleCollaborators = collaborators.slice(0, MAX_COLLABORATOR_ROWS);
  const hiddenCollaboratorCount = Math.max(0, collaborators.length - MAX_COLLABORATOR_ROWS);

  const panelClass =
    variant === 'floating'
      ? `absolute z-20 right-3 top-3 w-[min(22rem,34vw)] max-h-[50vh] flex flex-col min-h-0 overflow-hidden ${CHAT_FLOATING_PANEL_CHROME}`
      : variant === 'stacked'
        ? `flex h-full min-h-0 flex-col overflow-hidden ${CHAT_FLOATING_PANEL_CHROME}`
        : 'w-[min(22rem,34vw)] shrink-0 border-l border-divider bg-surface flex flex-col min-h-0';

  if (!resolvedProject) {
    if (!resolvedId) return null;
    return (
      <aside className={panelClass}>
        <div className="px-4 py-3 shrink-0">
          <h2 className="text-sm font-semibold text-text-primary truncate">Overview</h2>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-4 text-text-tertiary">
          <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading overview" />
        </div>
      </aside>
    );
  }

  return (
    <aside className={panelClass}>
      <div className="px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text-primary truncate">Overview</h2>
          {onViewAll && (
            <button
              type="button"
              onClick={onViewAll}
              className="shrink-0 p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-black/[0.04]"
              aria-label="View full overview"
              title="View full overview"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {resolvedProject.subject && (
          <p className="mt-1 text-xs text-text-secondary line-clamp-3">{resolvedProject.subject}</p>
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
          {collaboratorsLoading && visibleCollaborators.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-text-tertiary">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading…
            </div>
          ) : (
            <div className="space-y-2">
              <ul>
                {visibleCollaborators.map((person) => (
                  <CollaboratorRow key={person.id} {...person} />
                ))}
              </ul>
              {hiddenCollaboratorCount > 0 ? (
                <p className="text-[11px] text-text-tertiary">
                  +{hiddenCollaboratorCount} more
                </p>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
