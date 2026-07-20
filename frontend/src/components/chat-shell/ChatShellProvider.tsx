'use client';

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChatShellContext } from './ChatShellContext';
import { resolveDefaultProjectId } from './ChangeProjectSelect';
import {
  buildProjectWorkbenchPath,
  parseContextPanelParam,
  type ChatContextExpandedWidget,
} from '@/components/chat-shell/chatContextStackMotion';
import type { Project } from '@/lib/api';
import { isDemoActive, DEMO_PROJECT_ID } from '@/lib/demo/demoSession';

const LAST_PROJECT_KEY = 'nitrogen-last-project-id';

export function readLastProjectId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const id = localStorage.getItem(LAST_PROJECT_KEY);
    // Stale demo ids must never drive post-login routing.
    if (!id || id === DEMO_PROJECT_ID) return null;
    return id;
  } catch {
    return null;
  }
}

export function writeLastProjectId(projectId: string | null) {
  if (typeof window === 'undefined') return;
  // Demo is a sessionStorage-scoped overlay — never let it write into the
  // persistent, cross-session "last project" preference for the real account.
  if (isDemoActive() || projectId === DEMO_PROJECT_ID) return;
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
  const initiativeMatch = /^\/projects\/([^/]+)/.exec(pathname);
  const fromRoute = initiativeMatch?.[1] ?? projectParam;
  if (fromRoute === DEMO_PROJECT_ID && !isDemoActive()) {
    // Orphaned demo URL after leaving demo — fall through to a real project.
  } else if (fromRoute && (projects.length === 0 || projects.some((project) => project.id === fromRoute))) {
    return fromRoute;
  }
  if (projects.length > 0) {
    return resolveDefaultProjectId(projects, fromRoute === DEMO_PROJECT_ID ? null : fromRoute, readLastProjectId());
  }
  return fromRoute === DEMO_PROJECT_ID ? readLastProjectId() : (fromRoute ?? readLastProjectId());
}

/** @deprecated Prefer buildProjectWorkbenchPath — kept for Settings delete flows on /chat. */
export function buildChatPath(
  pathname: string,
  searchParams: URLSearchParams,
  projectId: string | null,
): string {
  if (projectId) {
    const chat = searchParams.get('chat');
    return buildProjectWorkbenchPath(projectId, {
      chat,
      panel: parseContextPanelParam(searchParams.get('panel')),
      assessment: searchParams.get('assessment'),
    });
  }
  const basePath = pathname.startsWith('/chat') || pathname === '/' ? '/chat' : pathname;
  const params = new URLSearchParams(searchParams.toString());
  params.delete('project');
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function ChatShellProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeChatId, setActiveChatId] = useState<string | null>(searchParams.get('chat'));
  const [drawerRefreshKey, setDrawerRefreshKey] = useState(0);
  const [activeContextWidget, setActiveContextWidget] = useState<ChatContextExpandedWidget | null>(null);
  const landingResetRef = useRef<(() => boolean) | null>(null);

  const pathProjectId = /^\/projects\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const activeProjectId = pathProjectId ?? searchParams.get('project');

  const registerLandingReset = useCallback((handler: (() => boolean) | null) => {
    landingResetRef.current = handler;
  }, []);

  useEffect(() => {
    setActiveChatId(searchParams.get('chat'));
  }, [searchParams]);

  const handleSelectChat = useCallback((chatId: string, projectId?: string | null) => {
    setActiveChatId(chatId);
    setActiveContextWidget(null);
    if (projectId) {
      writeLastProjectId(projectId);
      router.replace(buildProjectWorkbenchPath(projectId, { chat: chatId }));
      return;
    }
    const params = new URLSearchParams();
    params.set('chat', chatId);
    router.replace(`/chat?${params.toString()}`);
  }, [router]);

  const handleNewChat = useCallback((projectId?: string | null) => {
    const currentProject = pathProjectId ?? searchParams.get('project');
    const currentChat = searchParams.get('chat');
    const onProjectWorkbench = Boolean(pathProjectId);
    const onChatLandingPage = pathname === '/chat' || pathname === '/';

    // Already on this project's chat floor — clear overlays unless switching project.
    if (onProjectWorkbench && !currentChat) {
      const leftOverlay = landingResetRef.current?.() ?? false;
      if (leftOverlay) {
        if (!projectId || projectId === currentProject) return;
      } else if (projectId && currentProject === projectId) {
        return;
      }
    }

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
      router.replace(buildProjectWorkbenchPath(projectId));
      return;
    }
    const lastProjectId = readLastProjectId();
    if (lastProjectId) {
      router.replace(buildProjectWorkbenchPath(lastProjectId));
      return;
    }
    router.replace('/chat');
  }, [pathProjectId, pathname, router, searchParams]);

  const refreshDrawer = useCallback(() => {
    setDrawerRefreshKey((k) => k + 1);
  }, []);

  /**
   * "New Project" doesn't touch the backend at all — it just navigates to a
   * plain client-side onboarding route. Nothing is created until the user
   * actually sends their first message there, so there is no draft to
   * discard, no orphan to clean up, and Back is just... back.
   */
  const handleNewProject = useCallback(async () => {
    if (isDemoActive()) return;
    router.push('/projects/new');
  }, [router]);

  const openProjectContextPanel = useCallback((projectId: string, widget: ChatContextExpandedWidget) => {
    writeLastProjectId(projectId);
    setActiveChatId(null);
    setActiveContextWidget(widget);
    router.replace(buildProjectWorkbenchPath(projectId, { panel: widget }));
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
