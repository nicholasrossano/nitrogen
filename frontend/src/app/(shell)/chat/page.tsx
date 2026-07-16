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

/**
 * Personal (no-project) chat only. Project work lives on `/projects/[id]`.
 * Resolves a project when possible and navigates there so entry points stay unchanged.
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
    if (!activeWorkspace) void loadWorkspaces();
  }, [activeWorkspace, loadWorkspaces]);

  useEffect(() => {
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
    if (!projectsLoaded || !activeWorkspace?.id) return;

    let cancelled = false;

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

    if (projects.length === 0) {
      void api.createProject('New Project', activeWorkspace.id)
        .then((project) => {
          if (cancelled) return;
          setProjects([project]);
          chatShell?.refreshDrawer();
          goToProject(project.id);
        })
        .catch(() => {
          if (!cancelled) setResolving(false);
        });
      return () => {
        cancelled = true;
      };
    }

    setResolving(false);
    return undefined;
  }, [
    activeChatId,
    activeWorkspace?.id,
    assessmentParam,
    chatShell,
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
