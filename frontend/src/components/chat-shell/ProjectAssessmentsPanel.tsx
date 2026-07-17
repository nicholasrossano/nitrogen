'use client';

import { useMemo, useState } from 'react';
import { Check, ExternalLink, Loader2 } from 'lucide-react';
import { ALL_MODULES } from '@/components/chat/AssessmentPicker';
import { CHAT_FLOATING_PANEL_CHROME } from '@/components/ui/chatSidebarLayout';
import { StatusCapsule } from '@/components/ui/StatusCapsule';
import type { AssessmentInstance } from '@/lib/api';
import { assessmentHeaderTitle } from '@/lib/assessmentDisplay';

const MAX_ROWS = 5;

const ASSESSMENT_META = new Map(ALL_MODULES.map((module) => [module.id, module]));

function instanceUpdatedAtMs(instance: AssessmentInstance): number {
  const raw = instance.updated_at || instance.started_at;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function instanceLabel(instance: AssessmentInstance): string {
  const typeFallback = ASSESSMENT_META.get(instance.assessment_id)?.name
    || instance.assessment_id.replace(/_/g, ' ');
  // Prefer server display_name (includes · @creator when useful); else titled name.
  const raw = instance.display_name?.trim()
    || assessmentHeaderTitle(instance.title, typeFallback, instance.creator_handle);
  return raw || typeFallback;
}

function statusLabel(instance: AssessmentInstance): { label: string; className: string } {
  if (instance.is_plan_complete === true) {
    return {
      label: 'Confirmed',
      className: 'border-accent/20 bg-accent-wash/60 text-accent',
    };
  }
  if (instance.status === 'draft') {
    return {
      label: 'Draft',
      className: 'border-stroke-subtle bg-surface-subtle text-text-tertiary',
    };
  }
  return {
    label: 'In progress',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
  };
}

interface ProjectAssessmentsPanelProps {
  plannedAssessmentIds?: string[];
  assessmentInstances: AssessmentInstance[];
  loading?: boolean;
  readOnly?: boolean;
  onViewAll?: () => void;
  onOpenAssessment?: (assessment: {
    instanceId: string;
    assessmentId: string;
    title?: string | null;
  }) => void;
  onStartAssessment?: (assessmentId: string, assessmentName: string) => Promise<void>;
}

export function ProjectAssessmentsPanel({
  assessmentInstances,
  loading = false,
  onViewAll,
  onOpenAssessment,
}: ProjectAssessmentsPanelProps) {
  const [openingInstanceId, setOpeningInstanceId] = useState<string | null>(null);
  const rows = useMemo(() => (
    [...assessmentInstances]
      .sort((a, b) => instanceUpdatedAtMs(b) - instanceUpdatedAtMs(a))
      .slice(0, MAX_ROWS)
      .map((instance) => {
        const meta = ASSESSMENT_META.get(instance.assessment_id);
        return {
          instance,
          name: instanceLabel(instance),
          icon: meta?.icon ?? null,
          status: statusLabel(instance),
        };
      })
  ), [assessmentInstances]);

  return (
    <aside className={`flex h-full min-h-0 flex-col overflow-hidden ${CHAT_FLOATING_PANEL_CHROME}`}>
      <div className="px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text-primary">Assessments</h2>
          {onViewAll ? (
            <button
              type="button"
              onClick={onViewAll}
              className="shrink-0 p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-black/[0.04]"
              aria-label="View all assessments"
              title="View all assessments"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          ) : null}
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
            No assessments yet. Open Assessments to get started.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) => {
              const complete = row.instance.is_plan_complete === true;
              const isOpening = openingInstanceId === row.instance.id;
              return (
                <li key={row.instance.id}>
                  <button
                    type="button"
                    disabled={isOpening}
                    onClick={() => {
                      if (!onOpenAssessment) {
                        onViewAll?.();
                        return;
                      }
                      setOpeningInstanceId(row.instance.id);
                      onOpenAssessment({
                        instanceId: row.instance.id,
                        assessmentId: row.instance.assessment_id,
                        title: row.name,
                      });
                      setOpeningInstanceId(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-md border border-stroke-subtle bg-white px-2.5 py-2 text-left transition-colors hover:bg-surface-subtle"
                  >
                    <div
                      className={[
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded',
                        complete ? 'bg-accent text-white' : 'bg-accent-wash text-accent',
                      ].join(' ')}
                    >
                      {complete ? (
                        <Check className="w-3.5 h-3.5" strokeWidth={2.4} />
                      ) : isOpening ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{row.icon}</span>
                      )}
                    </div>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-text-primary">
                      {row.name}
                    </span>
                    <StatusCapsule className={`shrink-0 ${row.status.className}`}>
                      {row.status.label}
                    </StatusCapsule>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
