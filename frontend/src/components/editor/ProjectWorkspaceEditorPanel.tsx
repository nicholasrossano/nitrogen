'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, FolderOpen, Plus, X } from 'lucide-react';
import { ModuleWorkspace } from '@/components/modules/ModuleWorkspace';
import { DecisionLogWorkspaceTab } from '@/components/decision-log/DecisionLogWorkspaceTab';
import { DocumentViewerWidget } from '@/components/widgets/DocumentViewerWidget';
import { Tooltip } from '@/components/ui/Tooltip';
import { EditorSidePanel } from './EditorSidePanel';
import { WorkspaceHub, WorkspaceLaunchMode } from './WorkspaceHub';
import { type ModuleInstance } from '@/lib/api';
import type { EditorWidget } from './EditorSidePanel';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import type { PlanWorkspaceInspectorState } from '@/components/plan-workspace';

export type WorkspacePanelTab =
  | { id: 'chat-artifacts'; kind: 'artifacts'; title: 'Chat Outputs' }
  | { id: string; kind: 'module'; title: string; instanceId: string; moduleId: string }
  | { id: string; kind: 'decision-log'; title: string; moduleInstanceId: string; moduleId?: string }
  | { id: string; kind: 'document'; title: string; citation: ResearchPanelCitation };

export interface FrameworkPlanModuleOption {
  id: string;
  name: string;
  icon: React.ReactNode;
}

interface ProjectWorkspaceEditorPanelProps {
  initiativeId: string;
  tabs: WorkspacePanelTab[];
  activeTabId: string | null;
  onActiveTabChange: (tabId: string | null) => void;
  onOpenTab: (tab: WorkspacePanelTab) => void;
  onCloseTab: (tabId: string) => void;
  chatWidgets: EditorWidget[];
  workspaceLaunchMode: WorkspaceLaunchMode;
  onWorkspaceLaunchModeHandled: () => void;
  showModuleActions?: boolean;
  frameworkPlanModules?: FrameworkPlanModuleOption[];
  onNewModule?: (moduleId: string, moduleName: string) => void;
  onSendToChat?: (content: string, toolHint?: string) => void;
  onOpenChatSession?: (chat: { chatId: string; title?: string | null }) => void;
  onOpenDecisionLog?: (context: { instanceId: string; moduleId: string; title: string }) => void;
  onExportDecisionLog?: (context: { instanceId: string; moduleId: string; title: string }) => void | Promise<void>;
  onModuleInspectorStateChange?: (state: PlanWorkspaceInspectorState | null) => void;
}

export function ProjectWorkspaceEditorPanel({
  initiativeId,
  tabs,
  activeTabId,
  onActiveTabChange,
  onOpenTab,
  onCloseTab,
  chatWidgets,
  workspaceLaunchMode,
  onWorkspaceLaunchModeHandled,
  showModuleActions = true,
  frameworkPlanModules,
  onNewModule,
  onSendToChat,
  onOpenChatSession,
  onOpenDecisionLog,
  onExportDecisionLog,
  onModuleInspectorStateChange,
}: ProjectWorkspaceEditorPanelProps) {
  const [localWorkspaceLaunchMode, setLocalWorkspaceLaunchMode] = useState<WorkspaceLaunchMode>('idle');
  const [showNewModuleDropdown, setShowNewModuleDropdown] = useState(false);
  const newModuleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showNewModuleDropdown) return;
    function handleOutsideClick(e: MouseEvent) {
      if (newModuleRef.current && !newModuleRef.current.contains(e.target as Node)) {
        setShowNewModuleDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showNewModuleDropdown]);
  useEffect(() => {
    if (workspaceLaunchMode === 'idle') return;
    // Persist parent-triggered launches (e.g. side drawer click) locally so the
    // hub stays visible even after parent acknowledges the launch event.
    setLocalWorkspaceLaunchMode(workspaceLaunchMode);
  }, [workspaceLaunchMode]);
  const effectiveWorkspaceLaunchMode =
    localWorkspaceLaunchMode !== 'idle' ? localWorkspaceLaunchMode : workspaceLaunchMode;
  const showWorkspaceHub = effectiveWorkspaceLaunchMode !== 'idle' || !activeTabId;
  const openModeActive = showWorkspaceHub && effectiveWorkspaceLaunchMode === 'open';

  const activeTab = useMemo(() => {
    if (!activeTabId) return null;
    return tabs.find((tab) => tab.id === activeTabId) ?? null;
  }, [tabs, activeTabId]);

  const openExistingModule = async (instance: ModuleInstance) => {
    setLocalWorkspaceLaunchMode('idle');
    onOpenTab({
      id: `module-${instance.id}`,
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
            const isActive = tab.id === activeTabId && !showWorkspaceHub;
            const style = { flexShrink: 0, width: 148 };

            return (
              <button
                key={tab.id}
                onClick={() => {
                  setLocalWorkspaceLaunchMode('idle');
                  onActiveTabChange(tab.id);
                }}
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
                <Tooltip content={tab.title} className="flex-1 min-w-0" fitContent showDelayMs={1000}>
                  <span className="block truncate text-left">{tab.title}</span>
                </Tooltip>
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-black/10 flex-shrink-0 flex items-center justify-center"
                >
                  <X className="w-3 h-3" />
                </span>
              </button>
            );
          })}
          </div>
          {showModuleActions && (
            <div className="flex-shrink-0 flex items-center gap-0.5 px-1.5 border-l border-divider">
              {frameworkPlanModules && frameworkPlanModules.length > 0 && onNewModule && (
                <div className="relative" ref={newModuleRef}>
                  <button
                    onClick={() => setShowNewModuleDropdown((prev) => !prev)}
                    className={[
                      'flex items-center justify-center w-7 h-7 rounded transition-colors',
                      showNewModuleDropdown
                        ? 'bg-white text-text-primary shadow-subtle'
                        : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle',
                    ].join(' ')}
                    title="New module"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  {showNewModuleDropdown && (
                    <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-divider rounded-lg shadow-lg z-50 overflow-hidden">
                      <div className="px-3 py-2 border-b border-divider">
                        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                          Framework Modules
                        </h3>
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        {frameworkPlanModules.map((mod) => (
                          <button
                            key={mod.id}
                            type="button"
                            onClick={() => {
                              onNewModule(mod.id, mod.name);
                              setShowNewModuleDropdown(false);
                            }}
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface-subtle text-left border-b border-divider last:border-b-0 transition-colors"
                          >
                            <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center text-accent [&>svg]:w-4 [&>svg]:h-4">
                              {mod.icon}
                            </span>
                            <span className="text-xs text-text-primary">{mod.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => {
                  setLocalWorkspaceLaunchMode('open');
                  onActiveTabChange(null);
                }}
                aria-pressed={openModeActive}
                className={[
                  'flex items-center justify-center w-7 h-7 rounded transition-colors',
                  openModeActive
                    ? 'bg-white text-text-primary shadow-subtle'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle',
                ].join(' ')}
                title="Open module"
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        {showWorkspaceHub && (
          <WorkspaceHub
            key={initiativeId}
            initiativeId={initiativeId}
            launchMode={effectiveWorkspaceLaunchMode}
            onLaunchModeHandled={() => {
              onWorkspaceLaunchModeHandled();
            }}
            onSelectExisting={openExistingModule}
          />
        )}

        {activeTab?.kind === 'artifacts' && (
          <EditorSidePanel
            widgets={chatWidgets}
            initiativeId={initiativeId}
            onOpenDecisionLog={onOpenDecisionLog}
            onExportDecisionLog={onExportDecisionLog}
          />
        )}

        {activeTab?.kind === 'module' && (
          <ModuleWorkspace
            instanceId={activeTab.instanceId}
            moduleId={activeTab.moduleId}
            initiativeId={initiativeId}
            onAddToChat={(text) => onSendToChat?.(text, activeTab.moduleId)}
            onOpenDecisionLog={onOpenDecisionLog}
            onExportDecisionLog={onExportDecisionLog}
            onInspectorStateChange={onModuleInspectorStateChange}
          />
        )}

        {activeTab?.kind === 'decision-log' && (
          <DecisionLogWorkspaceTab
            moduleInstanceId={activeTab.moduleInstanceId}
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
