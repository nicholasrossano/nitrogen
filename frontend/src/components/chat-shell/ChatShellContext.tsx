'use client';

import { createContext, useContext } from 'react';

export interface ChatShellContextValue {
  activeChatId: string | null;
  onSelectChat: (chatId: string, projectId?: string | null) => void;
  onNewChat: (projectId?: string | null) => void;
  drawerRefreshKey: number;
  refreshDrawer: () => void;
}

export const ChatShellContext = createContext<ChatShellContextValue | null>(null);

export function useChatShell() {
  return useContext(ChatShellContext);
}
