'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ProjectWorkbench } from '@/components/chat-shell/ProjectWorkbench';
import { PageLoader } from '@/components/ui/PageLoader';
import { DEMO_PROJECT_ID, isDemoActive, isLeavingDemoForAuth } from '@/lib/demo/demoSession';

function ProjectPageContent() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const isDemoProject = projectId === DEMO_PROJECT_ID;
  // sessionStorage is client-only — gate demo routes until after mount so SSR matches hydration.
  const [demoSessionOk, setDemoSessionOk] = useState(false);

  useEffect(() => {
    if (!isDemoProject) return;
    if (!isDemoActive()) {
      setDemoSessionOk(false);
      // Re-enter through /demo so the session flag is set; do not bounce to
      // / → /chat → /login (that looked like "/demo went to login").
      // Skip while Sign up is navigating to /login on purpose.
      if (!isLeavingDemoForAuth()) {
        router.replace('/demo');
      }
      return;
    }
    setDemoSessionOk(true);
  }, [isDemoProject, router]);

  if (isDemoProject && !demoSessionOk) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-0 bg-surface">
        <PageLoader label="" />
      </div>
    );
  }

  return <ProjectWorkbench projectId={projectId} />;
}

export default function ProjectPage() {
  return (
    <ProtectedRoute>
      <Suspense
        fallback={(
          <div className="flex flex-1 items-center justify-center min-h-0 bg-surface">
            <PageLoader label="" />
          </div>
        )}
      >
        <ProjectPageContent />
      </Suspense>
    </ProtectedRoute>
  );
}
