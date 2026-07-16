'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageLoader } from '@/components/ui/PageLoader';
import { readLastProjectId } from '@/components/chat-shell/ChatShellProvider';
import { buildProjectWorkbenchPath } from '@/components/chat-shell/chatContextStackMotion';

export default function HomeRedirectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const view = searchParams.get('view');
    const panel = searchParams.get('panel');
    const projectId = readLastProjectId();
    if (projectId) {
      if (view === 'files' || panel === 'files') {
        router.replace(buildProjectWorkbenchPath(projectId, { panel: 'files' }));
        return;
      }
      if (panel === 'overview' || panel === 'variables' || panel === 'framework' || panel === 'assessments') {
        router.replace(buildProjectWorkbenchPath(projectId, {
          panel: panel === 'framework' ? 'assessments' : panel,
        }));
        return;
      }
      router.replace(buildProjectWorkbenchPath(projectId));
      return;
    }
    router.replace('/chat');
  }, [router, searchParams]);

  return (
    <div className="flex-1 flex items-center justify-center min-h-full w-full bg-surface">
      <PageLoader label="" />
    </div>
  );
}
