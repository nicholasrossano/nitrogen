'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageLoader } from '@/components/ui/PageLoader';
import { readLastProjectId } from '@/components/chat-shell/ChatShellProvider';

export default function HomeRedirectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const view = searchParams.get('view');
    const projectId = readLastProjectId();
    if (view === 'files') {
      router.replace(projectId ? `/chat/files?project=${projectId}` : '/chat/files');
      return;
    }
    router.replace(projectId ? `/chat?project=${projectId}` : '/chat');
  }, [router, searchParams]);

  return (
    <div className="flex-1 flex items-center justify-center min-h-full w-full bg-surface">
      <PageLoader label="" />
    </div>
  );
}
