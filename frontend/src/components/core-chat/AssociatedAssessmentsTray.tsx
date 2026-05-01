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
    <div className="overflow-hidden rounded-t-xl rounded-b-none border border-stroke-subtle bg-white shadow-[0_-1px_0_rgba(0,0,0,0.02)]">
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-text-tertiary transition-colors hover:bg-surface-subtle/70"
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand associated assessments' : 'Collapse associated assessments'}
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        <span>{visibleAssessments.length} Assessment{visibleAssessments.length === 1 ? '' : 's'}</span>
      </button>
      {!collapsed ? (
        <div className="border-t border-stroke-subtle bg-white">
          {visibleAssessments.map((assessment, index) => {
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
                className={[
                  'group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-70',
                  index > 0 ? 'border-t border-stroke-subtle' : '',
                  'text-text-secondary enabled:hover:bg-surface-subtle enabled:hover:text-text-primary',
                ].join(' ')}
                aria-label={title}
              >
                <span className="text-accent">
                  {assessmentOption.icon}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                  {title}
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-quaternary transition-colors group-enabled:group-hover:text-text-tertiary" />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
