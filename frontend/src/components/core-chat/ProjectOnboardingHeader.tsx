'use client';

import { CheckCircle2, Circle, FileUp, Map, MessageSquare } from 'lucide-react';

import type { Initiative } from '@/lib/api';

interface ProjectOnboardingHeaderProps {
  initiative: Initiative;
  filesUploaded: number;
}

function StepRow({
  complete,
  title,
  detail,
  Icon,
}: {
  complete: boolean;
  title: string;
  detail: string;
  Icon: typeof MessageSquare;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-black/[0.05] bg-white px-4 py-3">
      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface-subtle text-text-tertiary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {complete ? (
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-accent" />
          ) : (
            <Circle className="h-4 w-4 flex-shrink-0 text-text-quaternary" />
          )}
          <p className="text-sm font-medium text-text-primary">{title}</p>
        </div>
        <p className="mt-1 text-sm leading-6 text-text-tertiary">{detail}</p>
      </div>
    </div>
  );
}

export function ProjectOnboardingHeader({
  initiative,
  filesUploaded,
}: ProjectOnboardingHeaderProps) {
  const title = initiative.title || 'New Project';
  const hasDescription = Boolean(initiative.project_description?.trim());
  const hasFiles = filesUploaded > 0;

  return (
    <div className="w-full">
      <div className="pt-10">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-tertiary">
          Project Onboarding
        </p>
        <h2 className="mt-2 text-xl font-semibold text-text-primary">{title}</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-text-secondary">
          Start with a short description, attach any supporting files, then review the proposed
          framework outline here in chat. Once you confirm it, Nitrogen will generate the full
          project plan and unlock the rest of the workspace.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <StepRow
          complete={hasDescription}
          title="Describe the project"
          detail="Tell Nitrogen what you are building, who it serves, and any goals or constraints."
          Icon={MessageSquare}
        />
        <StepRow
          complete={hasFiles}
          title="Upload supporting files"
          detail="Use the paperclip in the composer for briefs, decks, notes, or source documents."
          Icon={FileUp}
        />
        <StepRow
          complete={false}
          title="Confirm the framework outline"
          detail="Nitrogen will propose the plan structure in chat before generating the full framework."
          Icon={Map}
        />
      </div>
    </div>
  );
}
