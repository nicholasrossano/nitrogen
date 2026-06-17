'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ALL_MODULES } from '@/components/chat/AssessmentPicker';
import { useVisibleAssessments } from '@/hooks/useFeatureFlag';
import { api, type AssessmentInstance } from '@/lib/api';

const MODULE_MAP = new Map(ALL_MODULES.map((module) => [module.id, module]));

function outputTitle(instance: AssessmentInstance): string {
  const moduleMeta = MODULE_MAP.get(instance.assessment_id);
  return moduleMeta?.name ?? instance.assessment_id.replace(/_/g, ' ');
}

function outputAuthorEmail(instance: AssessmentInstance): string {
  if (instance.started_by_email?.trim()) return instance.started_by_email.trim();
  if (instance.started_by?.trim()) {
    const handle = instance.started_by.trim();
    return handle.length > 24 ? `${handle.slice(0, 22)}…` : handle;
  }
  return 'Unknown author';
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
      setInstances(data.filter((instance) => instance.is_plan_complete === true));
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

  const approvedOutputs = useMemo(
    () => instances
      .filter((instance) => visibleModuleIds.has(instance.assessment_id))
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)),
    [instances, visibleModuleIds],
  );

  if (!loading && approvedOutputs.length === 0) {
    return null;
  }

  return (
    <section className="w-full overflow-visible pb-2">
      <p className="mb-3 pl-6 text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
        Outputs
      </p>
      <div className="mx-auto w-[90%] overflow-visible rounded-2xl border border-stroke-subtle bg-white p-3 sm:p-4">
        {loading ? (
          <div className="flex justify-center py-5">
            <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-3 overflow-visible px-1 py-2">
            {approvedOutputs.map((instance) => {
              const moduleMeta = MODULE_MAP.get(instance.assessment_id);
              const title = outputTitle(instance);
              const authorEmail = outputAuthorEmail(instance);

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
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
