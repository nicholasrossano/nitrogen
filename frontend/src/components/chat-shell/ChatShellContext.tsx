'use client';

import { createContext, useContext } from 'react';
import type { ChatContextExpandedWidget } from '@/components/chat-shell/chatContextStackMotion';

export interface ChatShellContextValue {
  activeChatId: string | null;
  activeProjectId: string | null;
  activeContextWidget: ChatContextExpandedWidget | null;
  onSelectChat: (chatId: string, projectId?: string | null) => void;
  onNewChat: (projectId?: string | null) => void;
  onNewProject?: () => Promise<void>;
  openProjectContextPanel: (projectId: string, widget: ChatContextExpandedWidget) => void;
  drawerRefreshKey: number;
  refreshDrawer: () => void;
  registerLandingReset: (handler: (() => boolean) | null) => void;
  setActiveContextWidget: (widget: ChatContextExpandedWidget | null) => void;
}

export const ChatShellContext = createContext<ChatShellContextValue | null>(null);

export function useChatShell() {
  return useContext(ChatShellContext);
}
