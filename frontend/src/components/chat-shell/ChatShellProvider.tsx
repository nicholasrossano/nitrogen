'use client';

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChatShellContext } from './ChatShellContext';
import {
  CONTEXT_PANEL_SEARCH_PARAM,
  type ChatContextExpandedWidget,
} from '@/components/chat-shell/chatContextStackMotion';

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

export function ChatShellProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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

