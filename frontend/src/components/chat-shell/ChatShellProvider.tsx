'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChatShellContext } from './ChatShellContext';

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

  useEffect(() => {
    setActiveChatId(searchParams.get('chat'));
  }, [searchParams]);

  const handleSelectChat = useCallback((chatId: string, projectId?: string | null) => {
    setActiveChatId(chatId);
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

    // Already on the chat landing page for this scope — nothing to do.
    if (onChatLandingPage && !currentChat) {
      if (projectId && currentProject === projectId) return;
      if (!projectId && !currentProject) return;
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

  const value = useMemo(
    () => ({
      activeChatId,
      onSelectChat: handleSelectChat,
      onNewChat: handleNewChat,
      drawerRefreshKey,
      refreshDrawer,
    }),
    [activeChatId, drawerRefreshKey, handleNewChat, handleSelectChat, refreshDrawer],
  );

  return <ChatShellContext.Provider value={value}>{children}</ChatShellContext.Provider>;
}
