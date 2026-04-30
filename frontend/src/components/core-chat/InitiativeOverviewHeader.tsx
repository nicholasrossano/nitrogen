'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Files, Layers3, ListChecks, Loader2, MapPinned, RefreshCw, Tag, Users } from 'lucide-react';
import { api, type AssumptionSummary, type Initiative } from '@/lib/api';
import type { ReadinessProgressData } from '@/components/ui/ReadinessProgressBar';
import { ReadinessProgressBar } from '@/components/ui/ReadinessProgressBar';

const collaboratorsCountCache = new Map<string, number>();

interface InitiativeOverviewHeaderProps {
  initiative: Initiative;
  filesUploaded: number;
  modulesCreated: number | null;
  readinessProgress?: ReadinessProgressData | null;
  isGenerating: boolean;
  errorMessage: string | null;
  canRefresh: boolean;
  onRefresh: () => void;
  onViewAssumptions?: () => void;
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
    <div className="rounded-xl border border-black/[0.05] bg-white px-4 py-3">
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

export function InitiativeOverviewHeader({
  initiative,
  filesUploaded,
  modulesCreated,
  readinessProgress,
  isGenerating,
  errorMessage,
  canRefresh,
  onRefresh,
  onViewAssumptions,
}: InitiativeOverviewHeaderProps) {
  const title = initiative.title || 'Untitled initiative';
  const projectType = formatProjectType(initiative.project_type);
  const hasFiles = filesUploaded > 0;
  const hasOverview = Boolean(initiative.overview_description?.trim());
  const [collaboratorsCount, setCollaboratorsCount] = useState<number | null>(
    () => collaboratorsCountCache.get(initiative.id) ?? null,
  );
  const [assumptionsSummary, setAssumptionsSummary] = useState<AssumptionSummary | null>(null);

  useEffect(() => {
    const cachedCount = collaboratorsCountCache.get(initiative.id);
    if (cachedCount !== undefined) {
      setCollaboratorsCount(cachedCount);
    } else {
      setCollaboratorsCount(null);
    }

    const hadCachedCount = cachedCount !== undefined;

    let cancelled = false;

    api.getShares(initiative.id)
      .then((shares) => {
        if (!cancelled) {
          const nextCount = 1 + shares.length;
          collaboratorsCountCache.set(initiative.id, nextCount);
          setCollaboratorsCount(nextCount);
        }
      })
      .catch(() => {
        if (!cancelled) {
          if (!hadCachedCount) {
            collaboratorsCountCache.set(initiative.id, 1);
            setCollaboratorsCount(1);
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initiative.id]);

  useEffect(() => {
    let cancelled = false;
    api.getAssumptionsSummary(initiative.id)
      .then((summary) => {
        if (!cancelled) setAssumptionsSummary(summary);
      })
      .catch(() => {
        if (!cancelled) setAssumptionsSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [initiative.id, initiative.updated_at]);

  return (
    <div className="w-full">
      <div className="min-w-0 pt-10">
        <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
      </div>

      {(initiative.geography || projectType) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {initiative.geography && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-accent/20 bg-accent/10 text-xs font-medium text-accent leading-none">
              <MapPinned className="w-3 h-3" />
              {initiative.geography}
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

      {readinessProgress && readinessProgress.total > 0 && (
        <ReadinessProgressBar
          progress={readinessProgress}
          className="mt-4 rounded-xl border border-black/[0.05] bg-surface-subtle/40 px-4 py-3"
        />
      )}

      <div className="mt-4 min-h-[150px] rounded-xl border border-black/[0.05] bg-surface-subtle/40 px-4 py-4">
        <div className="mb-4">
          <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider">Initiative Summary</p>
        </div>

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
          <p className="text-sm leading-7 text-text-secondary whitespace-pre-wrap">{initiative.overview_description}</p>
        ) : (
          <div className="h-full flex flex-col items-start justify-center">
            <p className="text-sm font-medium text-text-primary">No overview yet</p>
            <p className="mt-1 text-sm text-text-tertiary">Upload files to generate a project summary.</p>
          </div>
        )}

        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="min-h-[20px] text-xs text-text-tertiary">
            {errorMessage ? <span className="text-red-500">{errorMessage}</span> : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={!canRefresh || isGenerating}
              className="btn-compact-neutral"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  Refresh
                </>
              )}
            </button>
            <Link
              href={`/initiatives/${initiative.id}?view=framework`}
              className="inline-flex items-center justify-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-lg whitespace-nowrap border border-accent bg-accent text-white transition-colors hover:bg-accent-hover hover:border-accent-hover"
            >
              View Framework Plan
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FootprintBox label="Collaborators" value={collaboratorsCount} Icon={Users} />
        <FootprintBox label="Modules Created" value={modulesCreated} Icon={Layers3} />
        <FootprintBox label="Files Uploaded" value={filesUploaded} Icon={Files} />
      </div>

      <div className="mt-4 rounded-xl border border-black/[0.05] bg-white px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-text-tertiary uppercase tracking-wider">
              <ListChecks className="w-3.5 h-3.5" />
              Assumptions
            </div>
            <p className="mt-1 text-sm text-text-tertiary">
              Reusable project values and claims used across modules and research.
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
            <p className="text-xs text-text-tertiary">Confirmed</p>
            <p className="mt-1 text-xl font-semibold text-text-primary tabular-nums">
              {assumptionsSummary?.confirmed ?? '—'}
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
    </div>
  );
}
