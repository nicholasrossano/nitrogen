'use client';

import { useEffect, useState } from 'react';
import { Calculator, Files, ListChecks, Loader2, MapPinned, Tag, Users } from 'lucide-react';
import { api, type AssumptionSummary, type Project } from '@/lib/api';
import type { AssessmentProgressData } from '@/components/ui/ReadinessProgressBar';
import { AssessmentsProgressBar } from '@/components/ui/ReadinessProgressBar';
import { StatusOverviewTable } from '@/components/project-status/StatusOverviewTable';
import { PROJECT_VARIABLES } from '@/lib/projectVariablesCopy';
import type { ResearchPanelCitation } from './ResearchPanel';

const collaboratorsCountCache = new Map<string, number>();

interface ProjectOverviewHeaderProps {
  project: Project;
  filesUploaded: number;
  assessmentsCreated: number | null;
  assessmentProgress?: AssessmentProgressData | null;
  isGenerating: boolean;
  errorMessage: string | null;
  onViewAssumptions?: () => void;
  healthRefreshToken?: number;
  onOpenDocument?: (citation: ResearchPanelCitation) => void;
  onOpenWorkspaceAssessment?: (assessment: {
    instanceId: string;
    assessmentId: string;
    title?: string | null;
  }) => void;
}

function formatProjectType(value: string | null): string | null {
  if (!value) return null;
  return value
    .split('_')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function FootprintBox({
  label,
  value,
  Icon,
}: {
  label: string;
  value: number | null;
  Icon: typeof Files;
}) {
  return (
    <div className="rounded-xl border border-black/[0.05] bg-surface-subtle/40 px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-medium text-text-tertiary uppercase tracking-wider">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-text-primary tabular-nums">
        {value === null ? '—' : value}
      </div>
    </div>
  );
}

export function ProjectOverviewHeader({
  project,
  filesUploaded,
  assessmentsCreated,
  assessmentProgress,
  isGenerating,
  errorMessage,
  onViewAssumptions,
  healthRefreshToken = 0,
  onOpenDocument,
  onOpenWorkspaceAssessment,
}: ProjectOverviewHeaderProps) {
  const title = project.title || 'Untitled initiative';
  const projectType = formatProjectType(project.project_type);
  const hasFiles = filesUploaded > 0;
  const hasOverview = Boolean(project.overview_description?.trim());
  const [collaboratorsCount, setCollaboratorsCount] = useState<number | null>(
    () => collaboratorsCountCache.get(project.id) ?? null,
  );
  const [assumptionsSummary, setAssumptionsSummary] = useState<AssumptionSummary | null>(null);

  useEffect(() => {
    const cachedCount = collaboratorsCountCache.get(project.id);
    if (cachedCount !== undefined) {
      setCollaboratorsCount(cachedCount);
    } else {
      setCollaboratorsCount(null);
    }

    const hadCachedCount = cachedCount !== undefined;

    let cancelled = false;

    api.getShares(project.id)
      .then((shares) => {
        if (!cancelled) {
          const nextCount = 1 + shares.length;
          collaboratorsCountCache.set(project.id, nextCount);
          setCollaboratorsCount(nextCount);
        }
      })
      .catch(() => {
        if (!cancelled) {
          if (!hadCachedCount) {
            collaboratorsCountCache.set(project.id, 1);
            setCollaboratorsCount(1);
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    api.getAssumptionsSummary(project.id)
      .then((summary) => {
        if (!cancelled) setAssumptionsSummary(summary);
      })
      .catch(() => {
        if (!cancelled) setAssumptionsSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, project.updated_at]);

  return (
    <div className="relative w-full">
      <div className="mx-auto w-full max-w-3xl">
      <div className="min-w-0 pt-10">
        <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
      </div>

      {(project.geography || projectType) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {project.geography && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-accent/20 bg-accent/10 text-xs font-medium text-accent leading-none">
              <MapPinned className="w-3 h-3" />
              {project.geography}
            </span>
          )}
          {projectType && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-xs font-medium text-amber-700 leading-none">
              <Tag className="w-3 h-3" />
              {projectType}
            </span>
          )}
        </div>
      )}

      {assessmentProgress && assessmentProgress.total > 0 && (
        <section className="mt-6">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-secondary">
              Assessments
            </p>
          </div>
          <AssessmentsProgressBar
            progress={assessmentProgress}
            showHeader={true}
            showCategoryLabel={false}
            className="mt-2 rounded-xl border border-black/[0.05] bg-surface-subtle/40 px-4 py-3"
          />
        </section>
      )}

      <section className="mt-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-secondary">Status Overview</p>
        <StatusOverviewTable
          initiativeId={project.id}
          readOnly={project.shared_role === 'viewer'}
          hideRefreshButton={true}
          refreshToken={healthRefreshToken}
          onOpenDocument={onOpenDocument}
          onOpenWorkspaceAssessment={onOpenWorkspaceAssessment}
        />
      </section>

      <section className="mt-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-secondary">Initiative Summary</p>
      <div className="mt-2 min-h-[150px] rounded-xl border border-black/[0.05] bg-surface-subtle/40 px-4 py-4">
        {!hasFiles ? (
          <div className="h-full flex flex-col items-start justify-center">
            <p className="text-sm font-medium text-text-primary">No overview yet</p>
            <p className="mt-1 text-sm text-text-tertiary">Upload files to generate a project summary.</p>
          </div>
        ) : isGenerating && !hasOverview ? (
          <div className="h-full flex flex-col items-start justify-center">
            <div className="inline-flex items-center gap-2 text-sm font-medium text-text-primary">
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
              Generating overview...
            </div>
            <p className="mt-2 text-sm text-text-tertiary">Reviewing uploaded files and initiative context.</p>
          </div>
        ) : hasOverview ? (
          <p className="text-sm leading-7 text-text-secondary whitespace-pre-wrap">{project.overview_description}</p>
        ) : (
          <div className="h-full flex flex-col items-start justify-center">
            <p className="text-sm font-medium text-text-primary">No overview yet</p>
            <p className="mt-1 text-sm text-text-tertiary">Upload files to generate a project summary.</p>
          </div>
        )}

        {errorMessage ? (
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="text-xs text-red-500">{errorMessage}</div>
          </div>
        ) : null}
      </div>
      </section>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FootprintBox label="Collaborators" value={collaboratorsCount} Icon={Users} />
        <FootprintBox label="Assessments Created" value={assessmentsCreated} Icon={Calculator} />
        <FootprintBox label="Files Uploaded" value={filesUploaded} Icon={Files} />
      </div>

      <section className="mt-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-secondary">{PROJECT_VARIABLES.title}</p>
      <div className="mt-2 rounded-xl border border-black/[0.05] bg-surface-subtle/40 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="mt-1 text-sm text-text-tertiary">
              Reusable project values and claims used across assessments and research.
            </p>
          </div>
          <button type="button" className="btn-compact-neutral" onClick={onViewAssumptions}>
            View All
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-text-tertiary">Total</p>
            <p className="mt-1 text-xl font-semibold text-text-primary tabular-nums">
              {assumptionsSummary?.total ?? '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-text-tertiary">Validated</p>
            <p className="mt-1 text-xl font-semibold text-text-primary tabular-nums">
              {assumptionsSummary?.validated ?? '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-text-tertiary">Missing</p>
            <p className="mt-1 text-xl font-semibold text-red-500 tabular-nums">
              {assumptionsSummary?.missing ?? '—'}
            </p>
          </div>
        </div>

        {assumptionsSummary?.top_attention?.length ? (
          <div className="mt-3 border-t border-divider pt-3">
            <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider">Needs attention</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {assumptionsSummary.top_attention.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
                >
                  {item.label}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      </section>
      </div>
    </div>
  );
}
