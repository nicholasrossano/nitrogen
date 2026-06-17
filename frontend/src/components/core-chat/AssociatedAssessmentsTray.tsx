'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ALL_MODULES } from '@/components/chat/AssessmentPicker';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';

export type AssociatedChatAssessment = {
  instance_id: string;
  assessment_id: string;
  title: string | null;
  status: string;
  started_at: string | null;
};

interface AssociatedAssessmentsTrayProps {
  assessments: AssociatedChatAssessment[];
  onOpenWorkspaceAssessment?: (assessment: {
    instanceId: string;
    assessmentId: string;
    title?: string | null;
    chatId?: string | null;
    chatTitle?: string | null;
  }) => void;
}

export function AssociatedAssessmentsTray({
  assessments,
  onOpenWorkspaceAssessment,
}: AssociatedAssessmentsTrayProps) {
  const showBetaAssessments = useFeatureFlag('beta_assessments');
  const [collapsed, setCollapsed] = useState(false);
  const visibleAssessments = assessments.filter((assessment) => {
    const assessmentOption = ALL_MODULES.find((candidate) => candidate.id === assessment.assessment_id);
    if (!assessmentOption) return false;
    return showBetaAssessments || !assessmentOption.beta;
  });

  return (
    <div className="chat-composer-tray">
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        className="flex w-full items-center gap-1.5 px-4 py-2 text-[11px] font-medium text-text-secondary transition-colors hover:bg-black/[0.03]"
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand associated assessments' : 'Collapse associated assessments'}
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5 text-text-tertiary" /> : <ChevronDown className="h-3.5 w-3.5 text-text-tertiary" />}
        <span>{visibleAssessments.length} Assessment{visibleAssessments.length === 1 ? '' : 's'}</span>
      </button>
      {!collapsed ? (
        <div className="divide-y divide-stroke-subtle/80">
          {visibleAssessments.map((assessment) => {
            const assessmentOption = ALL_MODULES.find((candidate) => candidate.id === assessment.assessment_id);
            if (!assessmentOption) return null;

            const title = assessment.title?.trim() || assessmentOption.name;

            return (
              <button
                key={assessment.instance_id}
                type="button"
                onClick={() =>
                  onOpenWorkspaceAssessment?.({
                    instanceId: assessment.instance_id,
                    assessmentId: assessment.assessment_id,
                    title,
                  })
                }
                disabled={!onOpenWorkspaceAssessment}
                className="group flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors disabled:cursor-default disabled:opacity-70 text-text-secondary enabled:hover:bg-black/[0.03] enabled:hover:text-text-primary"
                aria-label={title}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                  {assessmentOption.icon}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                  {title}
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary transition-colors group-enabled:group-hover:text-text-secondary" />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
