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
      return;
    }
    setProjectsLoaded(false);
    api.listProjects(100, 0, false, activeWorkspace.id)
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setProjectsLoaded(true));
  }, [activeWorkspace?.id, chatShell?.drawerRefreshKey]);

  useEffect(() => {
    if (isDemoActive()) return;
    if (!projectsLoaded || !activeWorkspace?.id) return;

    const goToProject = (projectId: string) => {
      writeLastProjectId(projectId);
      router.replace(buildProjectWorkbenchPath(projectId, {
        chat: activeChatId,
        panel: panelParam,
        assessment: assessmentParam,
      }));
    };

    const resolved = resolveActiveProjectId('/chat', legacyProjectParam, projects);
    if (resolved) {
      goToProject(resolved);
      return;
    }

    // No projects yet — send them through the real onboarding route instead of
    // auto-creating an empty workbench that skips the describe step.
    if (projects.length === 0) {
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
    projectsLoaded,
    router,
  ]);

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
