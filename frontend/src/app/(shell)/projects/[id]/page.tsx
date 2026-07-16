'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ProjectWorkbench } from '@/components/chat-shell/ProjectWorkbench';
import { PageLoader } from '@/components/ui/PageLoader';

function ProjectPageContent() {
  const params = useParams();
  const projectId = params.id as string;
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
