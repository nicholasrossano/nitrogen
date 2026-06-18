'use client';

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChatShellContext } from './ChatShellContext';
import { resolveDefaultProjectId } from './ChangeProjectSelect';
import {
  CONTEXT_PANEL_SEARCH_PARAM,
  type ChatContextExpandedWidget,
} from '@/components/chat-shell/chatContextStackMotion';
import { api, type Project } from '@/lib/api';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const LAST_PROJECT_KEY = 'nitrogen-last-project-id';

export function readLastProjectId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function writeLastProjectId(projectId: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (projectId) localStorage.setItem(LAST_PROJECT_KEY, projectId);
    else localStorage.removeItem(LAST_PROJECT_KEY);
  } catch {
    // ignore
  }
}

export function resolveActiveProjectId(
  pathname: string,
  projectParam: string | null,
  projects: Project[] = [],
): string | null {
  const initiativeMatch = /^\/initiatives\/([^/]+)/.exec(pathname);
  const fromRoute = initiativeMatch?.[1] ?? projectParam;
  if (fromRoute && (projects.length === 0 || projects.some((project) => project.id === fromRoute))) {
    return fromRoute;
  }
  if (
    fromRoute &&
    projectParam === fromRoute &&
    (pathname === '/chat' || pathname === '/' || pathname.startsWith('/chat/'))
  ) {
    return fromRoute;
  }
  if (projects.length > 0) {
    return resolveDefaultProjectId(projects, fromRoute, readLastProjectId());
  }
  return readLastProjectId();
}

export function buildChatPath(
  pathname: string,
  searchParams: URLSearchParams,
  projectId: string | null,
): string {
  const basePath = pathname.startsWith('/chat/files')
    ? '/chat/files'
    : pathname.startsWith('/chat') || pathname === '/'
      ? '/chat'
      : pathname;
  const params = new URLSearchParams(searchParams.toString());
  if (projectId) {
    params.set('project', projectId);
  } else {
    params.delete('project');
  }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function ChatShellProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeWorkspace } = useWorkspaceStore();
  const [activeChatId, setActiveChatId] = useState<string | null>(searchParams.get('chat'));
  const [drawerRefreshKey, setDrawerRefreshKey] = useState(0);
  const [activeContextWidget, setActiveContextWidget] = useState<ChatContextExpandedWidget | null>(null);
  const landingResetRef = useRef<(() => boolean) | null>(null);

  const activeProjectId = searchParams.get('project');

  const registerLandingReset = useCallback((handler: (() => boolean) | null) => {
    landingResetRef.current = handler;
  }, []);

  useEffect(() => {
    setActiveChatId(searchParams.get('chat'));
  }, [searchParams]);

  const handleSelectChat = useCallback((chatId: string, projectId?: string | null) => {
    setActiveChatId(chatId);
    setActiveContextWidget(null);
    if (projectId) writeLastProjectId(projectId);
    const params = new URLSearchParams();
    params.set('chat', chatId);
    if (projectId) params.set('project', projectId);
    router.replace(`/chat?${params.toString()}`);
  }, [router]);

  const handleNewChat = useCallback((projectId?: string | null) => {
    const currentProject = searchParams.get('project');
    const currentChat = searchParams.get('chat');
    const onChatLandingPage = pathname === '/chat' || pathname === '/';

    // Already on the chat landing page for this scope — nothing to do unless a
    // sub-view (variables, editor panel, etc.) is open on top of the landing.
    if (onChatLandingPage && !currentChat) {
      const leftOverlay = landingResetRef.current?.() ?? false;
      if (leftOverlay) {
        if (!projectId || projectId === currentProject) return;
      } else {
        if (projectId && currentProject === projectId) return;
        if (!projectId && !currentProject) return;
      }
    }

    setActiveChatId(null);
    if (projectId) {
      writeLastProjectId(projectId);
      router.replace(`/chat?project=${projectId}`);
      return;
    }
    const lastProjectId = readLastProjectId();
    if (lastProjectId) {
      router.replace(`/chat?project=${lastProjectId}`);
      return;
    }
    router.replace('/chat');
  }, [pathname, router, searchParams]);

  const refreshDrawer = useCallback(() => {
    setDrawerRefreshKey((k) => k + 1);
  }, []);

  const handleNewProject = useCallback(async () => {
    if (!activeWorkspace?.id) return;

    const project = await api.createProject('New Project', activeWorkspace.id);
    setActiveChatId(null);
    setActiveContextWidget(null);
    writeLastProjectId(project.id);
    refreshDrawer();
    router.replace(`/chat?project=${project.id}`);
  }, [activeWorkspace?.id, refreshDrawer, router]);

  const openProjectContextPanel = useCallback((projectId: string, widget: ChatContextExpandedWidget) => {
    writeLastProjectId(projectId);
    setActiveChatId(null);
    setActiveContextWidget(widget);
    const params = new URLSearchParams();
    params.set('project', projectId);
    params.set(CONTEXT_PANEL_SEARCH_PARAM, widget);
    router.replace(`/chat?${params.toString()}`);
  }, [router]);

  const value = useMemo(
    () => ({
      activeChatId,
      activeProjectId,
      activeContextWidget,
      onSelectChat: handleSelectChat,
      onNewChat: handleNewChat,
      onNewProject: handleNewProject,
      openProjectContextPanel,
      drawerRefreshKey,
      refreshDrawer,
      registerLandingReset,
      setActiveContextWidget,
    }),
    [
      activeChatId,
      activeContextWidget,
      activeProjectId,
      drawerRefreshKey,
      handleNewChat,
      handleNewProject,
      handleSelectChat,
      openProjectContextPanel,
      refreshDrawer,
      registerLandingReset,
    ],
  );

  return <ChatShellContext.Provider value={value}>{children}</ChatShellContext.Provider>;
}

/** Reset chat landing overlays (variables, editor, etc.) when the sidebar project header is clicked. */
export function useChatShellLandingReset(handler: () => boolean) {
  const chatShell = useContext(ChatShellContext);

  useEffect(() => {
    chatShell?.registerLandingReset(handler);
    return () => chatShell?.registerLandingReset(null);
  }, [chatShell, handler]);
}

