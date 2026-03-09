import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ChatMessage } from '@/lib/api';

export interface ChatTab {
  id: string;
  title: string;
  createdAt: number;
  /** True only for the first tab that syncs with the initiative store messages */
  isOnboarding: boolean;
  messages: ChatMessage[];
}

export interface ClosedChatTab {
  id: string;
  title: string;
  createdAt: number;
  closedAt: number;
  messages: ChatMessage[];
}

interface TabGroup {
  tabs: ChatTab[];
  activeTabId: string;
  closedTabs: ClosedChatTab[];
}

interface ChatTabsStore {
  groups: Record<string, TabGroup>;

  ensureGroup: (initId: string) => TabGroup;
  setActiveTab: (initId: string, tabId: string) => void;
  createTab: (initId: string) => string;
  /** Pass messagesSnapshot when closing the onboarding tab so history has real messages */
  closeTab: (initId: string, tabId: string, messagesSnapshot?: ChatMessage[]) => void;
  reopenTab: (initId: string, tabId: string) => void;
  deleteClosedTab: (initId: string, tabId: string) => void;
  setTabTitle: (initId: string, tabId: string, title: string) => void;
  addMessage: (initId: string, tabId: string, msg: ChatMessage) => void;
  updateMessage: (initId: string, tabId: string, msgId: string, patch: Partial<ChatMessage>) => void;
  removeMessage: (initId: string, tabId: string, msgId: string) => void;
  /** Directly save a set of messages as a history entry (bypasses tab lifecycle) */
  saveToHistory: (initId: string, title: string, messages: ChatMessage[]) => void;
}

export const ONBOARDING_TAB_ID = 'onboarding';

function makeDefaultGroup(): TabGroup {
  return {
    tabs: [{ id: ONBOARDING_TAB_ID, title: 'Onboarding', createdAt: 0, isOnboarding: true, messages: [] }],
    activeTabId: ONBOARDING_TAB_ID,
    closedTabs: [],
  };
}

function patchGroup(
  prev: ChatTabsStore,
  initId: string,
  updater: (g: TabGroup) => Partial<TabGroup>,
): Partial<ChatTabsStore> {
  const g = prev.groups[initId] || makeDefaultGroup();
  return { groups: { ...prev.groups, [initId]: { ...g, ...updater(g) } } };
}

export const useChatTabsStore = create<ChatTabsStore>()(
  persist(
    (set, get) => ({
      groups: {},

      ensureGroup: (initId) => {
        let g = get().groups[initId];
        if (!g) {
          g = makeDefaultGroup();
          set((prev) => ({ groups: { ...prev.groups, [initId]: g! } }));
        }
        return g;
      },

      setActiveTab: (initId, tabId) =>
        set((prev) => patchGroup(prev, initId, () => ({ activeTabId: tabId }))),

      createTab: (initId) => {
        const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        set((prev) =>
          patchGroup(prev, initId, (g) => ({
            tabs: [
              ...g.tabs,
              { id, title: 'New Chat', createdAt: Date.now(), isOnboarding: false, messages: [] },
            ],
            activeTabId: id,
          })),
        );
        return id;
      },

      closeTab: (initId, tabId, messagesSnapshot) =>
        set((prev) =>
          patchGroup(prev, initId, (g) => {
            const tab = g.tabs.find((t) => t.id === tabId);
            if (!tab) return {};

            const remaining = g.tabs.filter((t) => t.id !== tabId);

            // If closing the last tab, auto-create a fresh one
            const autoTab: ChatTab | null =
              remaining.length === 0
                ? { id: `tab-${Date.now()}`, title: 'New Chat', createdAt: Date.now(), isOnboarding: false, messages: [] }
                : null;

            const finalTabs = autoTab ? [autoTab] : remaining;
            const newActiveId =
              g.activeTabId === tabId
                ? autoTab
                  ? autoTab.id
                  : finalTabs[Math.min(finalTabs.indexOf(tab as any) || 0, finalTabs.length - 1)]?.id || finalTabs[finalTabs.length - 1]?.id
                : g.activeTabId;

            const effectiveMessages = messagesSnapshot ?? tab.messages;
            const hasMessages = effectiveMessages.length > 0;

            const closed: ClosedChatTab | null = hasMessages
              ? {
                  id: tab.id,
                  title: tab.title,
                  createdAt: tab.createdAt,
                  closedAt: Date.now(),
                  messages: effectiveMessages,
                }
              : null;

            return {
              tabs: finalTabs,
              activeTabId: newActiveId,
              closedTabs: closed
                ? [closed, ...g.closedTabs].slice(0, 30)
                : g.closedTabs,
            };
          }),
        ),

      reopenTab: (initId, tabId) =>
        set((prev) =>
          patchGroup(prev, initId, (g) => {
            const closed = g.closedTabs.find((t) => t.id === tabId);
            if (!closed) return {};
            const reopened: ChatTab = {
              id: closed.id,
              title: closed.title,
              createdAt: closed.createdAt,
              isOnboarding: false,
              messages: closed.messages,
            };
            return {
              tabs: [...g.tabs, reopened],
              activeTabId: reopened.id,
              closedTabs: g.closedTabs.filter((t) => t.id !== tabId),
            };
          }),
        ),

      deleteClosedTab: (initId, tabId) =>
        set((prev) =>
          patchGroup(prev, initId, (g) => ({
            closedTabs: g.closedTabs.filter((t) => t.id !== tabId),
          })),
        ),

      setTabTitle: (initId, tabId, title) =>
        set((prev) =>
          patchGroup(prev, initId, (g) => ({
            tabs: g.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
          })),
        ),

      addMessage: (initId, tabId, msg) =>
        set((prev) =>
          patchGroup(prev, initId, (g) => ({
            tabs: g.tabs.map((t) =>
              t.id === tabId ? { ...t, messages: [...t.messages, msg] } : t,
            ),
          })),
        ),

      updateMessage: (initId, tabId, msgId, patch) =>
        set((prev) =>
          patchGroup(prev, initId, (g) => ({
            tabs: g.tabs.map((t) =>
              t.id === tabId
                ? { ...t, messages: t.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)) }
                : t,
            ),
          })),
        ),

      removeMessage: (initId, tabId, msgId) =>
        set((prev) =>
          patchGroup(prev, initId, (g) => ({
            tabs: g.tabs.map((t) =>
              t.id === tabId
                ? { ...t, messages: t.messages.filter((m) => m.id !== msgId) }
                : t,
            ),
          })),
        ),

      saveToHistory: (initId, title, messages) => {
        if (messages.length === 0) return;
        const entry: ClosedChatTab = {
          id: `standalone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title,
          createdAt: Date.now(),
          closedAt: Date.now(),
          messages,
        };
        set((prev) =>
          patchGroup(prev, initId, (g) => ({
            closedTabs: [entry, ...g.closedTabs].slice(0, 30),
          })),
        );
      },
    }),
    {
      name: 'nitrogen-chat-tabs',
      partialize: (s) => ({
        groups: Object.fromEntries(
          Object.entries(s.groups).map(([k, g]) => [
            k,
            {
              // Don't persist onboarding tab messages — always loaded fresh from API
              tabs: g.tabs.map((t) => (t.isOnboarding ? { ...t, messages: [] } : t)),
              activeTabId: g.activeTabId,
              closedTabs: g.closedTabs.slice(0, 30),
            },
          ]),
        ),
      }),
    },
  ),
);
