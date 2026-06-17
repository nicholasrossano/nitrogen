'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, type Assumption, type AssumptionStatus } from '@/lib/api';
import { CHAT_FLOATING_PANEL_CHROME } from '@/components/ui/chatSidebarLayout';
import { PROJECT_VARIABLES } from '@/lib/projectVariablesCopy';

const STATUS_CLASS: Record<AssumptionStatus, string> = {
  validated: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  extracted: 'bg-sky-50 text-sky-700 border-sky-200',
  assumed: 'bg-amber-50 text-amber-700 border-amber-200',
  missing: 'bg-surface-subtle text-text-secondary border-stroke-subtle',
};

function formatValue(value: unknown, unit?: string | null): string {
  if (value === null || value === undefined || value === '') return '—';
  const base = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return unit ? `${base} ${unit}` : base;
}

interface ProjectAssumptionsPanelProps {
  projectId: string | null;
  refreshKey?: number;
  onAssumptionSelect?: (assumption: Assumption) => void;
  onViewAll?: () => void;
}

export function ProjectAssumptionsPanel({
  projectId,
  refreshKey = 0,
  onAssumptionSelect,
  onViewAll,
}: ProjectAssumptionsPanelProps) {
  const [rows, setRows] = useState<Assumption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setRows([]);
      return;
    }
    setLoading(true);
    api
      .listAssumptions(projectId)
      .then((assumptions) => setRows(assumptions.slice(0, 12)))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [projectId, refreshKey]);

  if (!projectId) return null;

  return (
    <aside
      className={`flex flex-col min-h-0 flex-1 overflow-hidden ${CHAT_FLOATING_PANEL_CHROME}`}
    >
      <div className="px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text-primary">{PROJECT_VARIABLES.title}</h2>
          {onViewAll && (
            <button
              type="button"
              onClick={onViewAll}
              className="shrink-0 text-[10px] font-medium text-accent hover:underline"
            >
              View all
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-text-tertiary px-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <p className="px-1 text-xs text-text-secondary">
            No project {PROJECT_VARIABLES.lower} yet. Promote a finding from project chat to extract structured values.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onAssumptionSelect?.(row)}
                  disabled={!onAssumptionSelect}
                  className={`w-full text-left rounded-md border border-stroke-subtle bg-white px-2.5 py-2 transition-colors ${
                    onAssumptionSelect
                      ? 'hover:bg-surface-subtle cursor-pointer'
                      : 'disabled:cursor-default'
                  } disabled:hover:bg-white`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-text-primary leading-snug">{row.label}</span>
                    <span
                      className={`shrink-0 inline-flex px-1.5 py-0.5 rounded-full border text-[9px] font-medium capitalize ${STATUS_CLASS[row.status]}`}
                    >
                      {row.status}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-text-secondary truncate" title={formatValue(row.value, row.unit)}>
                    {formatValue(row.value, row.unit)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
