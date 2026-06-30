'use client';

import { useEffect } from 'react';
import { OpenAssessmentBrowser } from '@/components/chat/OpenAssessmentModal';
import { type AssessmentInstance } from '@/lib/api';

export type WorkspaceLaunchMode = 'idle' | 'open';

interface WorkspaceHubProps {
  projectId: string;
  launchMode?: WorkspaceLaunchMode;
  onLaunchModeHandled?: () => void;
  onSelectExisting: (instance: AssessmentInstance) => void;
}

export function WorkspaceHub({
  projectId,
  launchMode = 'idle',
  onLaunchModeHandled,
  onSelectExisting,
}: WorkspaceHubProps) {
  useEffect(() => {
    if (launchMode === 'open') {
      onLaunchModeHandled?.();
    }
  }, [launchMode, onLaunchModeHandled]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-8">
          <OpenAssessmentBrowser
            projectId={projectId}
            onSelect={onSelectExisting}
          />
        </div>
      </div>
    </div>
  );
}
