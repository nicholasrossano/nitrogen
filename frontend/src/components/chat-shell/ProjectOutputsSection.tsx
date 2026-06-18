'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ALL_MODULES } from '@/components/chat/AssessmentPicker';
import { useVisibleAssessments } from '@/hooks/useFeatureFlag';
import { useAuth } from '@/lib/auth';
import { api, type AssessmentInstance } from '@/lib/api';
import { isAssessmentUserEngaged } from '@/lib/assessmentEngagement';

const MODULE_MAP = new Map(ALL_MODULES.map((module) => [module.id, module]));
const OUTPUT_TILE_WIDTH = '11rem';
const OUTPUT_SCROLL_MAX_WIDTH = `calc(3 * ${OUTPUT_TILE_WIDTH} + 2 * 0.75rem)`;

function stripCreatorHandleFromTitle(
  title: string,
  creatorHandle?: string | null,
): string {
  const trimmed = title.trim();
  if (!trimmed) return trimmed;

  if (creatorHandle?.trim()) {
    const suffix = ` · @${creatorHandle.trim()}`;
    if (trimmed.endsWith(suffix)) {
      return trimmed.slice(0, -suffix.length).trim();
    }
  }

  return trimmed.replace(/\s*·\s*@[\w.-]+$/i, '').trim();
}

function outputTitle(instance: AssessmentInstance): string {
  const moduleMeta = MODULE_MAP.get(instance.assessment_id);
  const displayName = instance.display_name?.trim();
  if (displayName) {
    return stripCreatorHandleFromTitle(displayName, instance.creator_handle);
  }

  const title = instance.title?.trim();
  if (title) {
    return stripCreatorHandleFromTitle(title, instance.creator_handle);
  }

  const assessmentName = moduleMeta?.name ?? instance.assessment_id.replace(/_/g, ' ');
  if (instance.instance_number) {
    return `${assessmentName} #${instance.instance_number}`;
  }

  return assessmentName;
}

function outputAuthorEmail(instance: AssessmentInstance): string {
  if (instance.started_by_email?.trim()) return instance.started_by_email.trim();
  if (instance.started_by?.trim()) {
    const handle = instance.started_by.trim();
    return handle.length > 24 ? `${handle.slice(0, 22)}…` : handle;
  }
  return 'Unknown author';
}

function isOwnAssessment(
  instance: AssessmentInstance,
  userId: string | undefined,
  userEmail: string | null | undefined,
): boolean {
  if (userId && instance.started_by === userId) return true;

  const normalizedUserEmail = userEmail?.trim().toLowerCase();
  const normalizedInstanceEmail = instance.started_by_email?.trim().toLowerCase();
  return Boolean(normalizedUserEmail && normalizedInstanceEmail && normalizedUserEmail === normalizedInstanceEmail);
}

function shouldShowOutput(
  instance: AssessmentInstance,
  isOwn: boolean,
): boolean {
  if (instance.is_plan_complete === true) return true;
  if (!isOwn) return false;
  return isAssessmentUserEngaged(instance);
}

type OutputStatusTag = {
  label: 'Approved' | 'Draft' | 'In progress';
  className: string;
};

function outputStatusTag(instance: AssessmentInstance): OutputStatusTag {
  if (instance.is_plan_complete === true) {
    return {
      label: 'Approved',
      className: 'border-accent/20 bg-white/75 text-accent',
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
    className: 'border-stroke-subtle bg-surface-subtle text-text-secondary',
  };
}

interface ProjectOutputsSectionProps {
  projectId: string;
  onOpenOutput: (assessment: {
    instanceId: string;
    assessmentId: string;
    title?: string | null;
  }) => void;
  refreshKey?: number;
}

export function ProjectOutputsSection({
  projectId,
  onOpenOutput,
  refreshKey = 0,
}: ProjectOutputsSectionProps) {
  const { user } = useAuth();
  const visibleModules = useVisibleAssessments(ALL_MODULES);
  const visibleModuleIds = useMemo(
    () => new Set(visibleModules.map((module) => module.id)),
    [visibleModules],
  );
  const [instances, setInstances] = useState<AssessmentInstance[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listAssessmentInstances(projectId);
      setInstances(data);
    } catch {
      setInstances([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const handler = () => {
      void load();
    };
    window.addEventListener('nitrogen:assessment-workflow-updated', handler);
    return () => window.removeEventListener('nitrogen:assessment-workflow-updated', handler);
  }, [load]);

  const visibleOutputs = useMemo(
    () => instances
      .filter((instance) => {
        if (!visibleModuleIds.has(instance.assessment_id)) return false;
        const isOwn = isOwnAssessment(instance, user?.uid, user?.email);
        return shouldShowOutput(instance, isOwn);
      })
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)),
    [instances, user?.email, user?.uid, visibleModuleIds],
  );

  return (
    <section className="w-full overflow-visible pb-2">
      <p className="mb-3 pl-6 text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
        Outputs
      </p>
      <div className="w-full overflow-visible rounded-2xl border border-stroke-subtle bg-white p-3 sm:p-4">
        {loading ? (
          <div className="flex justify-center py-5">
            <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
          </div>
        ) : visibleOutputs.length === 0 ? (
          <p className="mx-auto max-w-[50%] px-2 py-6 text-center text-sm leading-relaxed text-text-secondary">
            Start an assessment to see progress here. If your team members finalize their own assessments, those will show up here too.
          </p>
        ) : (
          <div
            className="mx-auto w-full overflow-x-auto"
            style={{ maxWidth: OUTPUT_SCROLL_MAX_WIDTH }}
          >
            <div
              className={[
                'flex w-max min-w-full flex-nowrap gap-3 px-1 py-2',
                visibleOutputs.length <= 3 ? 'justify-center' : 'justify-start',
              ].join(' ')}
            >
              {visibleOutputs.map((instance) => {
                const moduleMeta = MODULE_MAP.get(instance.assessment_id);
                const title = outputTitle(instance);
                const authorEmail = outputAuthorEmail(instance);
                const statusTag = outputStatusTag(instance);

                return (
                  <div key={instance.id} className="overflow-visible p-1">
                    <button
                      type="button"
                      onClick={() => onOpenOutput({
                        instanceId: instance.id,
                        assessmentId: instance.assessment_id,
                        title,
                      })}
                      className="card-interactive flex w-[11rem] shrink-0 flex-col items-center rounded-xl border border-stroke-subtle bg-white p-3.5 text-center"
                    >
                      {moduleMeta?.icon ? (
                        <div className="mb-2.5 flex h-9 w-9 items-center justify-center rounded bg-accent-wash text-accent [&>svg]:h-4 [&>svg]:w-4">
                          {moduleMeta.icon}
                        </div>
                      ) : null}
                      <h3 className="w-full text-sm font-semibold leading-snug text-text-primary line-clamp-3">
                        {title}
                      </h3>
                      <p className="mt-1.5 w-full text-[11px] leading-snug text-text-tertiary line-clamp-2">
                        {authorEmail}
                      </p>
                      <span
                        className={[
                          'mt-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]',
                          statusTag.className,
                        ].join(' ')}
                      >
                        {statusTag.label}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
