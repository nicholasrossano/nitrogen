'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { EditorPanelHeader } from '@/components/editor/EditorPanelHeader';
import { LandingInput } from '@/components/core-chat/LandingInput';
import { ProjectOnboardingHeader } from '@/components/core-chat/ProjectOnboardingHeader';
import { PageLoader } from '@/components/ui/PageLoader';
import { api } from '@/lib/api';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { isDemoActive } from '@/lib/demo/demoSession';

/**
 * Client-only "New Project" landing. Nothing is created in the backend here —
 * the real project only comes into existence once the user sends their first
 * description below. That keeps Back conventional (plain history navigation,
 * no drafts to discard or orphans to clean up) and lets the existing backend
 * onboarding script (upload files -> propose assessments) kick off from that
 * first message.
 */
function NewProjectPageContent() {
  const router = useRouter();
  const { activeWorkspace, loadWorkspaces } = useWorkspaceStore();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isDemoActive()) {
      router.replace('/chat');
      return;
    }
    if (!activeWorkspace) void loadWorkspaces();
  }, [activeWorkspace, loadWorkspaces, router]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleDescribe = useCallback(async (content: string) => {
    if (creating) return;
    if (!activeWorkspace?.id) {
      setError('No active workspace. Please refresh and try again.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const project = await api.createProject('New Project', activeWorkspace.id);
      // Replace (not push) so /projects/new never sits in history behind the
      // real project — Back from the new project still lands on whatever was
      // open before New Project was clicked. The ?seed= is auto-sent once by
      // the workbench, then stripped from the URL.
      router.replace(`/projects/${project.id}?seed=${encodeURIComponent(content)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setCreating(false);
    }
  }, [activeWorkspace?.id, creating, router]);

  if (!activeWorkspace?.id) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-0 bg-surface">
        <PageLoader label="" />
      </div>
    );
  }

  const headerContent = (
    <>
      <ProjectOnboardingHeader />
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorPanelHeader title="Untitled" suffix="New Project" onBack={handleBack} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <LandingInput
          onSend={handleDescribe}
          disabled={creating}
          sendDisabled={creating}
          hideTiles
          showAttachments={false}
          placeholder="Briefly describe the project — what you are building, where, and any goals or constraints"
          headerContent={headerContent}
          layoutMode="default"
        />
      </div>
    </div>
  );
}

export default function NewProjectPage() {
  return (
    <ProtectedRoute>
      <Suspense
        fallback={(
          <div className="flex flex-1 items-center justify-center min-h-0 bg-surface">
            <PageLoader label="" />
          </div>
        )}
      >
        <NewProjectPageContent />
      </Suspense>
    </ProtectedRoute>
  );
}
