'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, HelpCircle, MinusCircle } from 'lucide-react';
import { api, type Project, type ProjectHealthDimension, type ProjectHealthStatus } from '@/lib/api';
import { CHAT_FLOATING_PANEL_CHROME } from '@/components/ui/chatSidebarLayout';

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

  if (!project) return null;

  const panelClass =
    variant === 'floating'
      ? `absolute z-20 right-3 top-3 w-[min(22rem,34vw)] max-h-[50vh] flex flex-col min-h-0 overflow-hidden ${CHAT_FLOATING_PANEL_CHROME}`
      : variant === 'stacked'
        ? `flex flex-col min-h-0 max-h-[45vh] overflow-hidden shrink-0 ${CHAT_FLOATING_PANEL_CHROME}`
        : 'w-[min(22rem,34vw)] shrink-0 border-l border-divider bg-surface flex flex-col min-h-0';

  return (
    <aside className={panelClass}>
      <div className="px-4 py-3 border-b border-divider shrink-0">
        <h2 className="text-sm font-semibold text-text-primary truncate">Overview</h2>
        {project.subject && (
          <p className="mt-1 text-xs text-text-secondary line-clamp-3">{project.subject}</p>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
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
      </div>
    </aside>
  );
}
