'use client';

import { FileUp, Map, MessageSquare } from 'lucide-react';

import type { Initiative } from '@/lib/api';

interface ProjectOnboardingHeaderProps {
  initiative: Initiative;
  filesUploaded: number;
}

function StepRow({
  title,
  detail,
  Icon,
}: {
  title: string;
  detail: string;
  Icon: typeof MessageSquare;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-accent bg-white px-4 py-4">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 w-full text-left">
        <p className="text-sm font-medium text-text-primary">{title}</p>
        <p className="mt-1 text-sm leading-6 text-text-tertiary">{detail}</p>
      </div>
    </div>
  );
}

export function ProjectOnboardingHeader({
  initiative: _initiative,
  filesUploaded: _filesUploaded,
}: ProjectOnboardingHeaderProps) {
  return (
    <div className="w-full">
      <div className="pt-10">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-tertiary">
          Project Onboarding
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-text-secondary">
          Start with a short description, upload supporting materials, then review the
          recommended framework assessments in chat. After confirmation, the full project plan is
          generated and the rest of the workspace unlocks.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <StepRow
          title="Describe the project"
          detail="Describe what you are building, who it serves, and any goals or constraints."
          Icon={MessageSquare}
        />
        <StepRow
          title="Upload supporting files"
          detail="Upload your existing project materials to jumpstart your work."
          Icon={FileUp}
        />
        <StepRow
          title="Confirm recommended assessments"
          detail="Review the suggested assessments and confirm the framework you'll work towards."
          Icon={Map}
        />
      </div>
    </div>
  );
}
