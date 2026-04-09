'use client';

import { useEffect, useMemo, useState } from 'react';
import { FileText, FolderOpen, Plus, X } from 'lucide-react';
import { ModuleWorkspace } from '@/components/modules/ModuleWorkspace';
import { DocumentViewerWidget } from '@/components/widgets/DocumentViewerWidget';
import { EditorSidePanel } from './EditorSidePanel';
import { WorkspaceHub, WorkspaceLaunchMode } from './WorkspaceHub';
import { api, type ModuleInstance } from '@/lib/api';
import type { EditorWidget } from './EditorSidePanel';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';

export type EditorWorkspaceTab =
  | { id: 'chat-artifacts'; kind: 'artifacts'; title: 'Chat Outputs' }
  | { id: string; kind: 'module'; title: string; instanceId: string; moduleId: string }
  | { id: string; kind: 'document'; title: string; citation: ResearchPanelCitation };

interface ProjectWorkspaceEditorPanelProps {
  initiativeId: string;
  chatWidgets: EditorWidget[];
  pendingDocument: ResearchPanelCitation | null;
  onPendingDocumentHandled: () => void;
  workspaceLaunchMode: WorkspaceLaunchMode;
  onWorkspaceLaunchModeHandled: () => void;
  preferArtifactsTab?: boolean;
  onArtifactsTabPreferredHandled?: () => void;
  onSendToChat?: (content: string, toolHint?: string) => void;
  onOpenChatSession?: (session: { sessionId: string; title?: string | null }) => void;
}

export function ProjectWorkspaceEditorPanel({
  initiativeId,
  chatWidgets,
  pendingDocument,
  onPendingDocumentHandled,
  workspaceLaunchMode,
  onWorkspaceLaunchModeHandled,
  preferArtifactsTab = false,
  onArtifactsTabPreferredHandled,
  onSendToChat,
  onOpenChatSession,
}: ProjectWorkspaceEditorPanelProps) {
  const [tabs, setTabs] = useState<EditorWorkspaceTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [localWorkspaceLaunchMode, setLocalWorkspaceLaunchMode] = useState<WorkspaceLaunchMode>('idle');
  const effectiveWorkspaceLaunchMode =
    localWorkspaceLaunchMode !== 'idle' ? localWorkspaceLaunchMode : workspaceLaunchMode;

  const addOrActivateTab = (tab: EditorWorkspaceTab) => {
    setTabs((prev) => {
      if (prev.some((existingTab) => existingTab.id === tab.id)) return prev;
      return [...prev, tab];
    });
    setActiveTabId(tab.id);
  };

  useEffect(() => {
    if (!pendingDocument) return;
    const tabId = `document-${pendingDocument.evidence_doc_id}-${pendingDocument.chunk_id ?? 'root'}`;
    setTabs((prev) => {
      if (prev.some((tab) => tab.id === tabId)) return prev;
      return [
        ...prev,
        {
          id: tabId,
          kind: 'document',
          title: pendingDocument.source_title || 'Document',
          citation: pendingDocument,
        },
      ];
    });
    setActiveTabId(tabId);
    onPendingDocumentHandled();
  }, [pendingDocument, onPendingDocumentHandled]);

  useEffect(() => {
    setTabs((prev) => {
      const hasArtifactsTab = prev.some((tab) => tab.id === 'chat-artifacts');
      if (chatWidgets.length > 0 && !hasArtifactsTab) {
        return [...prev, { id: 'chat-artifacts', kind: 'artifacts', title: 'Chat Outputs' }];
      }
      if (chatWidgets.length === 0 && hasArtifactsTab) {
        const nextTabs = prev.filter((tab) => tab.id !== 'chat-artifacts');
        if (activeTabId === 'chat-artifacts') {
          setActiveTabId(nextTabs[0]?.id ?? null);
        }
        return nextTabs;
      }
      return prev;
    });
  }, [chatWidgets, activeTabId]);

  useEffect(() => {
    if (!preferArtifactsTab) return;
    if (!chatWidgets.length) return;
    setActiveTabId('chat-artifacts');
    onArtifactsTabPreferredHandled?.();
  }, [preferArtifactsTab, chatWidgets.length, onArtifactsTabPreferredHandled]);

  const activeTab = useMemo(() => {
    if (!activeTabId) return null;
    return tabs.find((tab) => tab.id === activeTabId) ?? null;
  }, [tabs, activeTabId]);

  const closeTab = (tabId: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((tab) => tab.id === tabId);
      const nextTabs = prev.filter((tab) => tab.id !== tabId);
      if (activeTabId === tabId) {
        const fallback = nextTabs[Math.max(0, idx - 1)] ?? nextTabs[0] ?? null;
        setActiveTabId(fallback?.id ?? null);
      }
      return nextTabs;
    });
  };

  const openModuleTab = async (moduleId: string, moduleName?: string) => {
    const instance = await api.createModuleInstance(initiativeId, moduleId);
    const tabId = `module-${instance.id}`;
    addOrActivateTab({
      id: tabId,
      kind: 'module',
      title: moduleName ?? instance.module_id.replace(/_/g, ' '),
      instanceId: instance.id,
      moduleId: instance.module_id,
    });
  };

  const openExistingModule = async (instance: ModuleInstance) => {
    const tabId = `module-${instance.id}`;
    addOrActivateTab({
      id: tabId,
      kind: 'module',
      title: instance.title || instance.module_id.replace(/_/g, ' '),
      instanceId: instance.id,
      moduleId: instance.module_id,
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {tabs.length > 0 && (
        <div className="flex-shrink-0 flex items-stretch border-b border-divider bg-surface-subtle/50 h-[36px]">
          <div className="flex-1 flex items-stretch overflow-x-auto min-w-0" style={{ scrollbarWidth: 'none' }}>
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const style = isActive
              ? { flexShrink: 0, width: 148 }
              : { flex: '1 1 0', minWidth: 88 };

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
                  <FileText className="w-3.5 h-3.5" />
                </span>
                <span className="flex-1 truncate text-left">{tab.title}</span>
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
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
              onClick={() => {
                setLocalWorkspaceLaunchMode('open');
                setActiveTabId(null);
              }}
              className="flex items-center justify-center w-7 h-7 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
              title="Open module"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                setLocalWorkspaceLaunchMode('new');
                setActiveTabId(null);
              }}
              className="flex items-center justify-center w-7 h-7 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
              title="New module"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        {!activeTab && (
          <WorkspaceHub
            initiativeId={initiativeId}
            launchMode={effectiveWorkspaceLaunchMode}
            onLaunchModeHandled={() => {
              setLocalWorkspaceLaunchMode('idle');
              onWorkspaceLaunchModeHandled();
            }}
            onSelectModule={openModuleTab}
            onSelectExisting={openExistingModule}
          />
        )}

        {activeTab?.kind === 'artifacts' && (
          <EditorSidePanel
            widgets={chatWidgets}
            initiativeId={initiativeId}
          />
        )}

        {activeTab?.kind === 'module' && (
          <ModuleWorkspace
            instanceId={activeTab.instanceId}
            moduleId={activeTab.moduleId}
            initiativeId={initiativeId}
            onBack={() => closeTab(activeTab.id)}
            onAddToChat={(text) => onSendToChat?.(text, activeTab.moduleId)}
          />
        )}

        {activeTab?.kind === 'document' && (
          <DocumentViewerWidget
            data={{
              evidence_doc_id: activeTab.citation.evidence_doc_id,
              chunk_id: activeTab.citation.chunk_id,
              source_title: activeTab.citation.source_title,
            }}
            initiativeId={initiativeId}
            isActive
          />
        )}
      </div>
    </div>
  );
}
