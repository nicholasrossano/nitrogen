'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { api, type Variable } from '@/lib/api';
import { CHAT_FLOATING_PANEL_CHROME } from '@/components/ui/chatSidebarLayout';
import { PROJECT_VARIABLES } from '@/lib/projectVariablesCopy';
import { getCached, swrFetch, swrKeys } from '@/lib/swrCache';
import { VariableStatusCapsule } from '@/components/variables/VariableStatusCapsule';

function formatValue(value: unknown, unit?: string | null): string {
  if (value === null || value === undefined || value === '') return '—';
  const base = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return unit ? `${base} ${unit}` : base;
}

interface ProjectVariablesPanelProps {
  projectId: string | null;
  refreshKey?: number;
  onVariableSelect?: (variable: Variable) => void;
  onViewAll?: () => void;
}

export function ProjectVariablesPanel({
  projectId,
  refreshKey = 0,
  onVariableSelect,
  onViewAll,
}: ProjectVariablesPanelProps) {
  const [rows, setRows] = useState<Variable[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setRows([]);
      return;
    }
    const key = swrKeys.variables(projectId);
    const cached = getCached<Variable[]>(key);
    if (cached) {
      setRows(cached.slice(0, 12));
      setLoading(false);
    } else {
      setLoading(true);
    }

    let cancelled = false;
    void swrFetch(key, () => api.listVariables(projectId), { force: refreshKey > 0 })
      .then(({ data }) => {
        if (!cancelled) setRows(data.slice(0, 12));
      })
      .catch(() => {
        if (!cancelled && !cached) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  if (!projectId) return null;

  return (
    <aside
      className={`flex h-full min-h-0 flex-col overflow-hidden ${CHAT_FLOATING_PANEL_CHROME}`}
    >
      <div className="px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text-primary">{PROJECT_VARIABLES.title}</h2>
          {onViewAll && (
            <button
              type="button"
              onClick={onViewAll}
              className="shrink-0 p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-black/[0.04]"
              aria-label={`View all ${PROJECT_VARIABLES.lower}`}
              title={`View all ${PROJECT_VARIABLES.lower}`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
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
                  onClick={() => onVariableSelect?.(row)}
                  disabled={!onVariableSelect}
                  className={`w-full text-left rounded-md border border-stroke-subtle bg-white px-2.5 py-2 transition-colors ${
                    onVariableSelect
                      ? 'hover:bg-surface-subtle cursor-pointer'
                      : 'disabled:cursor-default'
                  } disabled:hover:bg-white`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-text-primary leading-snug">{row.label}</span>
                    <VariableStatusCapsule status={row.status} className="shrink-0" />
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
