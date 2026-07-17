'use client';

import { Suspense, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ProjectWorkbench } from '@/components/chat-shell/ProjectWorkbench';
import { PageLoader } from '@/components/ui/PageLoader';
import { DEMO_PROJECT_ID, isDemoActive } from '@/lib/demo/demoSession';

function ProjectPageContent() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  useEffect(() => {
    // After leaving demo, a stale /projects/demo-… URL must not keep painting fixtures.
    if (projectId === DEMO_PROJECT_ID && !isDemoActive()) {
      router.replace('/');
    }
  }, [projectId, router]);

  if (projectId === DEMO_PROJECT_ID && !isDemoActive()) {
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
