'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock, MessageSquare, Plus, Trash2, X } from 'lucide-react';
import { ProjectStandaloneChatView } from './ProjectStandaloneChatView';
import { Tooltip } from '@/components/ui/Tooltip';
import type { EditorWidget } from '@/components/editor/EditorSidePanel';
import type { SourceCitation } from '@/lib/api';
import { api } from '@/lib/api';
import type { ChatSession } from '@/stores/chatStore';

interface ProjectChatTab {
  id: string;
  title: string;
  chatId: string | null;
  isLanding: boolean;
  /** True only for auto-created placeholder tabs. */
  isFallback: boolean;
}

interface ProjectChatTabsPanelProps {
  initiativeId: string;
  researchMode?: boolean;
  sessionStorageKey?: string;
  resetToLandingSignal?: number;
  pendingChatToOpen?: { chatId: string; title?: string | null } | null;
  pendingAutoSend?: { requestId: string; content: string; toolHint?: string } | null;
  activeModuleContext?: { instanceId: string; moduleId: string; title?: string | null } | null;
  onPendingSessionHandled?: () => void;
  onPendingAutoSendHandled?: () => void;
  onEditorWidgetsChange?: (widgets: EditorWidget[]) => void;
  onCitationClick?: (citation: SourceCitation) => void;
  onOpenWorkspaceModule?: (module: { instanceId: string; moduleId: string; title?: string | null }) => void;
  onSendRef?: React.MutableRefObject<((content: string, toolHint?: string) => void) | null>;
}

function makeTab(title = 'New Chat', isLanding = false, isFallback = false): ProjectChatTab {
  return {
    id: `chat-tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    chatId: null,
    isLanding,
    isFallback,
  };
}

interface StoredProjectChatTabsState {
  tabs: ProjectChatTab[];
  activeTabId: string | null;
}

function isStoredProjectChatTab(value: unknown): value is ProjectChatTab {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ProjectChatTab>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    (typeof candidate.chatId === 'string' || candidate.chatId === null) &&
    typeof candidate.isLanding === 'boolean' &&
    typeof candidate.isFallback === 'boolean'
  );
}

function readStoredProjectChatTabsState(storageKey: string): StoredProjectChatTabsState | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredProjectChatTabsState>;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
    const tabs = parsed.tabs.filter(isStoredProjectChatTab);
    if (tabs.length === 0) return null;
    return {
      tabs,
      activeTabId:
        typeof parsed.activeTabId === 'string' && tabs.some((tab) => tab.id === parsed.activeTabId)
          ? parsed.activeTabId
          : tabs[0].id,
    };
  } catch {
    return null;
  }
}

function writeStoredProjectChatTabsState(
  storageKey: string,
  state: StoredProjectChatTabsState,
) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export function ProjectChatTabsPanel({
  initiativeId,
  researchMode = false,
  sessionStorageKey,
  resetToLandingSignal = 0,
  pendingChatToOpen = null,
  pendingAutoSend = null,
  activeModuleContext = null,
  onPendingSessionHandled,
  onPendingAutoSendHandled,
  onEditorWidgetsChange,
  onCitationClick,
  onOpenWorkspaceModule,
  onSendRef,
}: ProjectChatTabsPanelProps) {
  const initialStateRef = useRef<StoredProjectChatTabsState | null>(null);
  if (!initialStateRef.current) {
    const storedState = sessionStorageKey
      ? readStoredProjectChatTabsState(sessionStorageKey)
      : null;
    if (storedState) {
      initialStateRef.current = storedState;
    } else {
      const initialTab = makeTab('New Chat', researchMode, true);
      initialStateRef.current = {
        tabs: [initialTab],
        activeTabId: initialTab.id,
      };
    }
  }
  const [tabs, setTabs] = useState<ProjectChatTab[]>(() => initialStateRef.current!.tabs);
  const [activeTabId, setActiveTabId] = useState<string>(() => initialStateRef.current!.activeTabId ?? initialStateRef.current!.tabs[0].id);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);

  const resolvedActiveTabId = useMemo(
    () => (tabs.some((tab) => tab.id === activeTabId) ? activeTabId : tabs[0]?.id ?? null),
    [tabs, activeTabId],
  );
  const showTabBar = !researchMode || tabs.some((tab) => !tab.isLanding);

  useEffect(() => {
    if (!resolvedActiveTabId || resolvedActiveTabId === activeTabId) return;
    setActiveTabId(resolvedActiveTabId);
  }, [resolvedActiveTabId, activeTabId]);

  useEffect(() => {
    if (!sessionStorageKey || !resolvedActiveTabId) return;
    writeStoredProjectChatTabsState(sessionStorageKey, {
      tabs,
      activeTabId: resolvedActiveTabId,
    });
  }, [sessionStorageKey, tabs, resolvedActiveTabId]);

  const loadSessions = useCallback(async () => {
    try {
      const { chats: raw } = await api.getChats(initiativeId);
      setSessions(
        raw.map((session) => ({
          id: session.id,
          title: session.title || 'Untitled',
          createdAt: session.created_at ? new Date(session.created_at).getTime() : Date.now(),
          messages: [],
        })),
      );
    } catch (err) {
      console.warn('Failed to load chat sessions:', err);
    }
  }, [initiativeId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const findExistingNewChatTab = useCallback(
    () =>
      tabs.find(
        (tab) =>
          !tab.chatId &&
          (tab.isFallback || tab.title.trim().toLowerCase() === 'new chat'),
      ),
    [tabs],
  );

  const handleCreateTab = useCallback(() => {
    const existing = findExistingNewChatTab();
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

    const tab = makeTab('New Chat', false, false);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [findExistingNewChatTab]);

  const handleCloseTab = useCallback((tabId: string) => {
    if (tabs.length === 1) {
      const replacement = makeTab('New Chat', researchMode, true);
      setTabs([replacement]);
      setActiveTabId(replacement.id);
      return;
    }

    const idx = tabs.findIndex((tab) => tab.id === tabId);
    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    setTabs(nextTabs);

    if (tabId === activeTabId) {
      const fallback = nextTabs[Math.max(0, idx - 1)] ?? nextTabs[0];
      if (fallback) {
        setActiveTabId(fallback.id);
      }
    }
  }, [tabs, activeTabId, researchMode]);

  useEffect(() => {
    if (!showHistory) return;
    const handler = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showHistory]);

  useEffect(() => {
    if (!pendingChatToOpen?.chatId) return;

    const existingTab = tabs.find((tab) => tab.chatId === pendingChatToOpen.chatId);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      onPendingSessionHandled?.();
      return;
    }

    const activeTab = tabs.find((tab) => tab.id === resolvedActiveTabId);
    if (activeTab && activeTab.isFallback && !activeTab.chatId) {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTab.id
            ? {
                ...tab,
                title: pendingChatToOpen.title?.trim() || 'Untitled',
                chatId: pendingChatToOpen.chatId,
                isLanding: false,
                isFallback: false,
              }
            : tab,
        ),
      );
      setActiveTabId(activeTab.id);
    } else {
      const newTab: ProjectChatTab = {
        id: makeTab().id,
        title: pendingChatToOpen.title?.trim() || 'Untitled',
        chatId: pendingChatToOpen.chatId,
        isLanding: false,
        isFallback: false,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
    }
    onPendingSessionHandled?.();
  }, [pendingChatToOpen, tabs, resolvedActiveTabId, onPendingSessionHandled]);

  useEffect(() => {
    if (!researchMode || resetToLandingSignal === 0) return;
    const resetTab = makeTab('New Chat', true, true);
    setTabs([resetTab]);
    setActiveTabId(resetTab.id);
    setShowHistory(false);
  }, [researchMode, resetToLandingSignal]);

  const handleOpenSession = useCallback((session: ChatSession) => {
    const existingTab = tabs.find((tab) => tab.chatId === session.id);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      setShowHistory(false);
      return;
    }

    const activeTab = tabs.find((tab) => tab.id === resolvedActiveTabId);
    if (activeTab && activeTab.isFallback && !activeTab.chatId) {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTab.id
            ? {
                ...tab,
                title: session.title,
                chatId: session.id,
                isLanding: false,
                isFallback: false,
              }
            : tab,
        ),
      );
      setActiveTabId(activeTab.id);
    } else {
      const newTab: ProjectChatTab = {
        id: makeTab().id,
        title: session.title,
        chatId: session.id,
        isLanding: false,
        isFallback: false,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
    }
    setShowHistory(false);
  }, [tabs, resolvedActiveTabId]);

  const handleDeleteSession = useCallback((chatId: string) => {
    setSessions((prev) => prev.filter((session) => session.id !== chatId));
    const nextTabs = tabs.filter((tab) => tab.chatId !== chatId);
    if (nextTabs.length === 0) {
      const replacement = makeTab('New Chat', researchMode, true);
      setTabs([replacement]);
      setActiveTabId(replacement.id);
    } else {
      setTabs(nextTabs);
      setActiveTabId((current) =>
        nextTabs.some((tab) => tab.id === current) ? current : nextTabs[0].id,
      );
    }
    api.deleteChat(chatId).catch((err) => {
      console.error('Failed to delete session:', err);
      loadSessions();
    });
  }, [tabs, loadSessions, researchMode]);

  const handleTabMetaChange = useCallback((tabId: string, meta: { chatId: string | null; title: string | null }) => {
    const chatId = meta.chatId;
    if (chatId) {
      const title = meta.title?.trim() || 'Untitled';
      setSessions((prev) => {
        const existing = prev.find((session) => session.id === chatId);
        if (existing) {
          return prev.map((session) =>
            session.id === chatId ? { ...session, title } : session,
          );
        }
        return [{ id: chatId, title, createdAt: Date.now(), messages: [] }, ...prev].slice(0, 50);
      });
    }

    setTabs((prev) => {
      let changed = false;
      const nextTabs = prev.map((tab) => {
        if (tab.id !== tabId) return tab;
        const nextTitle = meta.title?.trim() || tab.title;
        if (tab.chatId === meta.chatId && tab.title === nextTitle) {
          return tab;
        }
        changed = true;
        return {
          ...tab,
          chatId: meta.chatId,
          title: nextTitle,
          isLanding: false,
          isFallback: false,
        };
      });
      return changed ? nextTabs : prev;
    });
  }, []);

  const handleLandingStateChange = useCallback((tabId: string, isLanding: boolean) => {
    setTabs((prev) => {
      let changed = false;
      const nextTabs = prev.map((tab) => {
        if (tab.id !== tabId || tab.isLanding === isLanding) return tab;
        changed = true;
        return { ...tab, isLanding };
      });
      return changed ? nextTabs : prev;
    });
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {showTabBar && (
        <div className="flex-shrink-0 flex items-stretch border-b border-divider bg-surface-subtle/50 h-[36px]">
          <div className="flex-1 flex items-stretch overflow-x-auto min-w-0" style={{ scrollbarWidth: 'none' }}>
            {tabs.map((tab) => {
              const isActive = tab.id === resolvedActiveTabId;
              const style = { flexShrink: 0, width: 148 };

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  style={style}
                  className={[
                    'group relative flex items-center gap-1 px-2.5 text-xs whitespace-nowrap transition-colors border-r border-divider last:border-r-0',
                    isActive
                      ? 'bg-white text-text-primary font-medium shadow-subtle z-10'
                      : 'text-text-tertiary hover:text-text-secondary hover:bg-white/60',
                  ].join(' ')}
                >
                  <span className="flex-shrink-0 text-text-tertiary">
                    <MessageSquare className="w-3.5 h-3.5" />
                  </span>
                  <Tooltip content={tab.title} className="flex-1 min-w-0" fitContent showDelayMs={2000}>
                    <span className="block truncate text-left">{tab.title}</span>
                  </Tooltip>
                  <span
                    onClick={(event) => {
                      event.stopPropagation();
                      handleCloseTab(tab.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-black/10 flex-shrink-0 flex items-center justify-center"
                  >
                    <X className="w-3 h-3" />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex-shrink-0 flex items-center gap-0.5 px-1.5 border-l border-divider">
            <div className="relative" ref={historyRef}>
              <button
                onClick={() => setShowHistory((prev) => !prev)}
                className={`
                  flex items-center justify-center w-7 h-7 rounded transition-colors
                  ${showHistory
                    ? 'text-accent bg-accent-wash'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle'}
                `}
                title="Chat history"
              >
                <Clock className="w-3.5 h-3.5" />
              </button>
              {showHistory && (
                <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-divider rounded-lg shadow-lg z-50 overflow-hidden">
                  <div className="px-3 py-2 border-b border-divider">
                    <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                      Chat History
                    </h3>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {sessions.length === 0 ? (
                      <div className="px-3 py-6 text-xs text-text-tertiary text-center">
                        No chat history
                      </div>
                    ) : (
                      sessions.map((session) => (
                        <div
                          key={session.id}
                          className="group flex items-center gap-2 px-3 py-2.5 hover:bg-surface-subtle cursor-pointer border-b border-divider last:border-b-0 transition-colors"
                          onClick={() => handleOpenSession(session)}
                        >
                          <MessageSquare className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-text-primary truncate">{session.title}</p>
                            <p className="text-[10px] text-text-tertiary mt-0.5">
                              {relativeTime(session.createdAt)}
                            </p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSession(session.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-50 text-text-tertiary hover:text-red-500 flex-shrink-0"
                            title="Delete conversation"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={handleCreateTab}
              className="flex items-center justify-center w-7 h-7 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
              title="New chat"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        {tabs.map((tab) => {
          const isActive = tab.id === resolvedActiveTabId;
          return (
            <div
              key={tab.id}
              className={isActive ? 'absolute inset-0' : 'absolute inset-0 hidden'}
            >
              <ProjectStandaloneChatView
                initiativeId={initiativeId}
                hideTiles={researchMode}
                useLandingWhenEmpty={tab.isLanding}
                initialChatId={tab.chatId}
                initialTitle={tab.title}
                sessions={sessions}
                activeModuleContext={activeModuleContext}
                onDeleteChat={handleDeleteSession}
                onChatListDirty={loadSessions}
                onChatMetaChange={(meta) => handleTabMetaChange(tab.id, meta)}
                onLandingStateChange={(isLanding) => handleLandingStateChange(tab.id, isLanding)}
                onEditorWidgetsChange={isActive ? onEditorWidgetsChange : undefined}
                onCitationClick={isActive ? onCitationClick : undefined}
                onOpenWorkspaceModule={isActive ? onOpenWorkspaceModule : undefined}
                onSendRef={isActive ? onSendRef : undefined}
                pendingAutoSend={isActive ? pendingAutoSend : null}
                onPendingAutoSendHandled={isActive ? onPendingAutoSendHandled : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
