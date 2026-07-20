'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { PersonalChatSurface } from '@/components/chat-shell/PersonalChatSurface';
import { useChatShell } from '@/components/chat-shell/ChatShellContext';
import { buildProjectWorkbenchPath, parseAssessmentParam, parseContextPanelParam } from '@/components/chat-shell/chatContextStackMotion';
import {
  resolveActiveProjectId,
  writeLastProjectId,
} from '@/components/chat-shell/ChatShellProvider';
import { decideChatLandingNavigation } from '@/lib/chatLandingNavigation';
import { api, type Project } from '@/lib/api';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { PageLoader } from '@/components/ui/PageLoader';
import { buildDemoProjectPath, isDemoActive } from '@/lib/demo/demoSession';

/**
 * Personal (no-project) chat only. Project work lives on `/projects/[id]`.
 *
 * New-user path: empty workspace → `/projects/new` (three-step onboarding header
 * + describe composer). First send creates the project and seeds the existing
 * upload → assessments script via `?seed=`.
 */
function ChatLandingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const chatShell = useChatShell();
  const { activeWorkspace, loadWorkspaces } = useWorkspaceStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [resolving, setResolving] = useState(true);

  const legacyProjectParam = searchParams.get('project');
  const activeChatId = searchParams.get('chat');
  const panelParam = parseContextPanelParam(searchParams.get('panel'));
  const assessmentParam = parseAssessmentParam(searchParams.get('assessment'));

  useEffect(() => {
    if (isDemoActive()) {
      router.replace(buildDemoProjectPath({
        chat: activeChatId,
        panel: panelParam,
      }));
    }
  }, [activeChatId, panelParam, router]);

  useEffect(() => {
    if (isDemoActive()) return;
    if (!activeWorkspace) void loadWorkspaces();
  }, [activeWorkspace, loadWorkspaces]);

  useEffect(() => {
    if (isDemoActive()) return;
    if (!activeWorkspace?.id) {
      setProjects([]);
      setProjectsLoaded(false);
      setProjectsError(null);
      return;
    }
    let cancelled = false;
    setProjectsLoaded(false);
    setProjectsError(null);
    api.listProjects(100, 0, false, activeWorkspace.id)
      .then((rows) => {
        if (cancelled) return;
        setProjects(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        // A failed request is not evidence the workspace is empty. Treating it
        // as "no projects" would bounce an existing user into onboarding —
        // surface a retry instead of guessing.
        setProjectsError(err instanceof Error ? err.message : 'Failed to load projects');
      })
      .finally(() => {
        if (!cancelled) setProjectsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.id, chatShell?.drawerRefreshKey, retryNonce]);

  useEffect(() => {
    if (isDemoActive()) return;
    if (!activeWorkspace?.id) return;

    const decision = decideChatLandingNavigation({
      projectsLoaded,
      projectsError,
      resolvedProjectId: resolveActiveProjectId('/chat', legacyProjectParam, projects),
      projectCount: projects.length,
    });

    if (decision.kind === 'hold' || decision.kind === 'show-error') return;

    if (decision.kind === 'goto-project') {
      writeLastProjectId(decision.projectId);
      router.replace(buildProjectWorkbenchPath(decision.projectId, {
        chat: activeChatId,
        panel: panelParam,
        assessment: assessmentParam,
      }));
      return;
    }

    if (decision.kind === 'goto-onboarding') {
      // No projects yet — send them through the real onboarding route instead of
      // auto-creating an empty workbench that skips the describe step.
      router.replace('/projects/new');
      return;
    }

    setResolving(false);
  }, [
    activeChatId,
    activeWorkspace?.id,
    assessmentParam,
    legacyProjectParam,
    panelParam,
    projects,
    projectsError,
    projectsLoaded,
    router,
  ]);

  if (projectsError) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 bg-surface px-4 text-center">
        <p className="text-sm text-text-secondary">Couldn&apos;t load your projects.</p>
        <p className="text-xs text-text-tertiary">{projectsError}</p>
        <button
          type="button"
          onClick={() => setRetryNonce((n) => n + 1)}
          className="rounded-full border border-stroke-subtle px-3 py-1.5 text-xs font-medium text-text-primary hover:border-black/20"
        >
          Try again
        </button>
      </div>
    );
  }

  if (resolving || !projectsLoaded) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-surface">
        <PageLoader label="" />
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-1 flex-col min-h-0 min-w-0 bg-surface">
      <PersonalChatSurface
        key="personal"
        initialChatId={activeChatId}
        useLandingWhenEmpty
        onChatListDirty={() => chatShell?.refreshDrawer()}
        onChatIdResolved={(chatId) => {
          const params = new URLSearchParams();
          params.set('chat', chatId);
          router.replace(`/chat?${params.toString()}`);
          chatShell?.refreshDrawer();
        }}
      />
    </div>
  );
}

export default function ChatPage() {
  return (
    <ProtectedRoute>
      <ChatLandingContent />
    </ProtectedRoute>
  );
}
