'use client';

import { useMemo, useState } from 'react';
import { Check, ExternalLink, Loader2 } from 'lucide-react';
import { ALL_MODULES, MODULE_CATEGORIES } from '@/components/chat/AssessmentPicker';
import { CHAT_FLOATING_PANEL_CHROME } from '@/components/ui/chatSidebarLayout';
import type { AssessmentInstance } from '@/lib/api';

const MAX_ROWS = 5;

const ASSESSMENT_META = new Map(ALL_MODULES.map((module) => [module.id, module]));

function resolvePhaseIndex(assessmentId: string): number {
  const categoryIndex = MODULE_CATEGORIES.findIndex((category) => (
    category.assessmentIds.includes(assessmentId)
  ));
  return categoryIndex >= 0 ? categoryIndex : MODULE_CATEGORIES.length;
}

/** Same phase order as FrameworkPlanView: category phases, then planned-id order within each. */
export function orderPlannedAssessmentsByFramework(plannedAssessmentIds: string[]): string[] {
  const buckets = new Map<number, string[]>();
  const unmatched: string[] = [];

  plannedAssessmentIds.forEach((assessmentId) => {
    const phaseIndex = resolvePhaseIndex(assessmentId);
    if (phaseIndex >= MODULE_CATEGORIES.length) {
      unmatched.push(assessmentId);
      return;
    }
    const bucket = buckets.get(phaseIndex) ?? [];
    bucket.push(assessmentId);
    buckets.set(phaseIndex, bucket);
  });

  const ordered: string[] = [];
  for (let index = 0; index < MODULE_CATEGORIES.length; index += 1) {
    const bucket = buckets.get(index);
    if (bucket?.length) ordered.push(...bucket);
  }
  ordered.push(...unmatched);
  return ordered;
}

function pickPrimaryInstance(
  assessmentId: string,
  instances: AssessmentInstance[],
): AssessmentInstance | null {
  const forType = instances
    .filter((instance) => instance.assessment_id === assessmentId)
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  const completed = forType.find((instance) => instance.is_plan_complete === true);
  return completed ?? forType[0] ?? null;
}

function statusLabel(instance: AssessmentInstance | null): { label: string; className: string } {
  if (!instance) {
    return {
      label: 'Not started',
      className: 'border-stroke-subtle bg-surface-subtle text-text-tertiary',
    };
  }
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
  plannedAssessmentIds: string[];
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
  plannedAssessmentIds,
  assessmentInstances,
  loading = false,
  readOnly = false,
  onViewAll,
  onOpenAssessment,
  onStartAssessment,
}: ProjectAssessmentsPanelProps) {
  const [startingAssessmentId, setStartingAssessmentId] = useState<string | null>(null);
  const rows = useMemo(() => {
    const orderedIds = orderPlannedAssessmentsByFramework(plannedAssessmentIds).slice(0, MAX_ROWS);
    return orderedIds.map((assessmentId) => {
      const meta = ASSESSMENT_META.get(assessmentId);
      const instance = pickPrimaryInstance(assessmentId, assessmentInstances);
      const name = meta?.name || assessmentId.replace(/_/g, ' ');
      return {
        assessmentId,
        name,
        icon: meta?.icon ?? null,
        instance,
        status: statusLabel(instance),
      };
    });
  }, [assessmentInstances, plannedAssessmentIds]);

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
            No assessments planned yet. Open Assessments to build the plan.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) => {
              const complete = row.instance?.is_plan_complete === true;
              const isStarting = startingAssessmentId === row.assessmentId;
              return (
                <li key={row.assessmentId}>
                  <button
                    type="button"
                    disabled={isStarting}
                    onClick={() => {
                      if (row.instance && onOpenAssessment) {
                        onOpenAssessment({
                          instanceId: row.instance.id,
                          assessmentId: row.instance.assessment_id,
                          title: row.instance.display_name || row.instance.title || row.name,
                        });
                        return;
                      }
                      if (!readOnly && onStartAssessment) {
                        setStartingAssessmentId(row.assessmentId);
                        void onStartAssessment(row.assessmentId, row.name).finally(() => {
                          setStartingAssessmentId(null);
                        });
                        return;
                      }
                      onViewAll?.();
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
                      ) : isStarting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{row.icon}</span>
                      )}
                    </div>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-text-primary">
                      {row.name}
                    </span>
                    <span
                      className={`shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide leading-none ${row.status.className}`}
                    >
                      {row.status.label}
                    </span>
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
