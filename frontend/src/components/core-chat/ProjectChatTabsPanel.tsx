'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock, MessageSquare, Plus, Trash2, X } from 'lucide-react';
import { ProjectStandaloneChatView } from './ProjectStandaloneChatView';
import type { EditorWidget } from '@/components/editor/EditorSidePanel';
import type { SourceCitation } from '@/lib/api';

interface ProjectChatTab {
  id: string;
  title: string;
  sessionId: string | null;
  isLanding: boolean;
}

interface ClosedChatTab extends ProjectChatTab {
  closedAt: number;
}

interface ProjectChatTabsPanelProps {
  initiativeId: string;
  researchMode?: boolean;
  resetToLandingSignal?: number;
  pendingSessionToOpen?: { sessionId: string; title?: string | null } | null;
  onPendingSessionHandled?: () => void;
  onEditorWidgetsChange?: (widgets: EditorWidget[]) => void;
  onCitationClick?: (citation: SourceCitation) => void;
  onSendRef?: React.MutableRefObject<((content: string, toolHint?: string) => void) | null>;
}

function makeTab(title = 'New Chat', isLanding = false): ProjectChatTab {
  return {
    id: `chat-tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    sessionId: null,
    isLanding,
  };
}

export function ProjectChatTabsPanel({
  initiativeId,
  researchMode = false,
  resetToLandingSignal = 0,
  pendingSessionToOpen = null,
  onPendingSessionHandled,
  onEditorWidgetsChange,
  onCitationClick,
  onSendRef,
}: ProjectChatTabsPanelProps) {
  const initialTabRef = useRef<ProjectChatTab | null>(null);
  if (!initialTabRef.current) {
    initialTabRef.current = makeTab('New Chat', researchMode);
  }
  const [tabs, setTabs] = useState<ProjectChatTab[]>(() => [initialTabRef.current!]);
  const [activeTabId, setActiveTabId] = useState<string>(() => initialTabRef.current!.id);
  const [closedTabs, setClosedTabs] = useState<ClosedChatTab[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId],
  );
  const showTabBar = !researchMode || tabs.some((tab) => !tab.isLanding);

  const handleCreateTab = useCallback(() => {
    const tab = makeTab('New Chat', researchMode);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [researchMode]);

  const handleCloseTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const closingTab = prev.find((tab) => tab.id === tabId);
      if (closingTab?.sessionId) {
        setClosedTabs((existing) => [
          { ...closingTab, closedAt: Date.now() },
          ...existing.filter((tab) => tab.sessionId !== closingTab.sessionId),
        ].slice(0, 20));
      }

      if (prev.length === 1) {
        const replacement = makeTab('New Chat', researchMode);
        setActiveTabId(replacement.id);
        return [replacement];
      }

      const idx = prev.findIndex((tab) => tab.id === tabId);
      const nextTabs = prev.filter((tab) => tab.id !== tabId);
      if (tabId === activeTabId) {
        const fallback = nextTabs[Math.max(0, idx - 1)] ?? nextTabs[0];
        if (fallback) {
          setActiveTabId(fallback.id);
        }
      }
      return nextTabs;
    });
  }, [activeTabId, researchMode]);

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
    if (!pendingSessionToOpen?.sessionId) return;

    const existingTab = tabs.find((tab) => tab.sessionId === pendingSessionToOpen.sessionId);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      onPendingSessionHandled?.();
      return;
    }

    const newTab: ProjectChatTab = {
      id: makeTab().id,
      title: pendingSessionToOpen.title?.trim() || 'Untitled',
      sessionId: pendingSessionToOpen.sessionId,
      isLanding: false,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    onPendingSessionHandled?.();
  }, [pendingSessionToOpen, tabs, onPendingSessionHandled]);

  useEffect(() => {
    if (!researchMode || resetToLandingSignal === 0) return;
    const resetTab = makeTab('New Chat', true);
    setTabs([resetTab]);
    setActiveTabId(resetTab.id);
    setShowHistory(false);
  }, [researchMode, resetToLandingSignal]);

  const handleReopenTab = (tabId: string) => {
    const tab = closedTabs.find((entry) => entry.id === tabId);
    if (!tab) return;
    setTabs((prev) => [...prev, { id: tab.id, title: tab.title, sessionId: tab.sessionId, isLanding: false }]);
    setActiveTabId(tab.id);
    setClosedTabs((prev) => prev.filter((entry) => entry.id !== tabId));
    setShowHistory(false);
  };

  const handleDeleteClosedTab = (tabId: string) => {
    setClosedTabs((prev) => prev.filter((entry) => entry.id !== tabId));
  };

  const handleTabMetaChange = useCallback((tabId: string, meta: { sessionId: string | null; title: string | null }) => {
    setTabs((prev) => {
      let changed = false;
      const nextTabs = prev.map((tab) => {
        if (tab.id !== tabId) return tab;
        const nextTitle = meta.title?.trim() || tab.title;
        if (tab.sessionId === meta.sessionId && tab.title === nextTitle) {
          return tab;
        }
        changed = true;
        return {
          ...tab,
          sessionId: meta.sessionId,
          title: nextTitle,
          isLanding: false,
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
              const isActive = tab.id === activeTabId;
              const style = isActive
                ? { flexShrink: 0, width: 136 }
                : { flex: '1 1 0', minWidth: 72 };

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
                  <span className="flex-1 truncate text-left">{tab.title}</span>
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
                    {closedTabs.length === 0 ? (
                      <div className="px-3 py-6 text-xs text-text-tertiary text-center">
                        No chat history
                      </div>
                    ) : (
                      closedTabs.map((tab) => (
                        <div
                          key={tab.id}
                          className="group flex items-center gap-2 px-3 py-2.5 hover:bg-surface-subtle cursor-pointer border-b border-divider last:border-b-0 transition-colors"
                          onClick={() => handleReopenTab(tab.id)}
                        >
                          <MessageSquare className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-text-primary truncate">{tab.title}</p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteClosedTab(tab.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-50 text-text-tertiary hover:text-red-500 flex-shrink-0"
                            title="Remove from history"
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
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={isActive ? 'absolute inset-0' : 'absolute inset-0 hidden'}
            >
              <ProjectStandaloneChatView
                initiativeId={initiativeId}
                hideTiles={researchMode}
                useLandingWhenEmpty={researchMode}
                initialSessionId={tab.sessionId}
                initialTitle={tab.title}
                onSessionMetaChange={(meta) => handleTabMetaChange(tab.id, meta)}
                onLandingStateChange={(isLanding) => handleLandingStateChange(tab.id, isLanding)}
                onEditorWidgetsChange={isActive ? onEditorWidgetsChange : undefined}
                onCitationClick={isActive ? onCitationClick : undefined}
                onSendRef={isActive ? onSendRef : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
