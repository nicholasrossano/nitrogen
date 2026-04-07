'use client';

import { useCallback, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { ProjectStandaloneChatView } from './ProjectStandaloneChatView';
import type { EditorWidget } from '@/components/editor/EditorSidePanel';
import type { SourceCitation } from '@/lib/api';

interface ProjectChatTab {
  id: string;
  title: string;
  sessionId: string | null;
}

interface ProjectChatTabsPanelProps {
  initiativeId: string;
  onEditorWidgetsChange?: (widgets: EditorWidget[]) => void;
  onCitationClick?: (citation: SourceCitation) => void;
  onSendRef?: React.MutableRefObject<((content: string, toolHint?: string) => void) | null>;
}

function makeTab(title = 'New Chat'): ProjectChatTab {
  return {
    id: `chat-tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    sessionId: null,
  };
}

export function ProjectChatTabsPanel({
  initiativeId,
  onEditorWidgetsChange,
  onCitationClick,
  onSendRef,
}: ProjectChatTabsPanelProps) {
  const [tabs, setTabs] = useState<ProjectChatTab[]>(() => [makeTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0]?.id ?? makeTab().id);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId],
  );

  const handleCreateTab = useCallback(() => {
    const tab = makeTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const handleCloseTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      if (prev.length === 1) {
        const replacement = makeTab();
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
  }, [activeTabId]);

  const handleTabMetaChange = useCallback((tabId: string, meta: { sessionId: string | null; title: string | null }) => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              sessionId: meta.sessionId,
              title: meta.title?.trim() || tab.title,
            }
          : tab,
      ),
    );
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
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
          <button
            onClick={handleCreateTab}
            className="flex items-center justify-center w-7 h-7 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
            title="New chat"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

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
                hideTiles={true}
                initialSessionId={tab.sessionId}
                initialTitle={tab.title}
                onSessionMetaChange={(meta) => handleTabMetaChange(tab.id, meta)}
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
