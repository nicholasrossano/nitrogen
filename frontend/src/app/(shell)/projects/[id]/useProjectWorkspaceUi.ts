'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { WorkspacePanelTab } from '@/components/editor';

import {
  DEFAULT_CHAT_PANEL_PERCENT,
  DEFAULT_PANEL_VISIBILITY,
  readStoredWorkspaceUiState,
  writeStoredWorkspaceUiState,
  type ProjectView,
  type StoredProjectWorkspaceUiState,
} from './projectWorkspaceTypes';

type PanelView = 'overview' | 'assessments' | 'framework' | 'assumptions';

interface HeaderToggleConfig {
  activeView: ProjectView;
  hasFrameworkSelection: boolean;
  isViewer: boolean;
  panelVisibility: StoredProjectWorkspaceUiState['panelVisibility'];
  workspaceOpen: boolean;
  chatOpen: boolean;
}

export function useProjectWorkspaceUi(projectId: string) {
  const workspaceUiStorageKey = `nitrogen_project_workspace_ui_${projectId}`;
  const initialWorkspaceUiRef = useRef<StoredProjectWorkspaceUiState | null>(null);
  if (!initialWorkspaceUiRef.current) {
    initialWorkspaceUiRef.current = readStoredWorkspaceUiState(workspaceUiStorageKey);
  }

  const [panelVisibility, setPanelVisibility] = useState(
    initialWorkspaceUiRef.current?.panelVisibility ?? DEFAULT_PANEL_VISIBILITY,
  );
  const [chatPanelWidthPercent, setChatPanelWidthPercent] = useState(
    initialWorkspaceUiRef.current?.chatPanelWidthPercent ?? DEFAULT_CHAT_PANEL_PERCENT,
  );
  const [isResizingChat, setIsResizingChat] = useState(false);
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspacePanelTab[]>(
    initialWorkspaceUiRef.current?.workspaceTabs ?? [],
  );
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState<string | null>(
    initialWorkspaceUiRef.current?.activeWorkspaceTabId ?? null,
  );

  const setPanelOpen = useCallback(
    (view: PanelView, panel: 'workspace' | 'chat', open: boolean) => {
      setPanelVisibility((prev) => {
        const current = prev[view];
        const next = { ...current, [panel]: open };
        if (!next.workspace && !next.chat) {
          next[panel] = true;
        }
        return {
          ...prev,
          [view]: next,
        };
      });
    },
    [],
  );

  const restoreWorkspaceUiFromStorage = useCallback(() => {
    const storedWorkspaceUi = readStoredWorkspaceUiState(workspaceUiStorageKey);
    setPanelVisibility(storedWorkspaceUi?.panelVisibility ?? DEFAULT_PANEL_VISIBILITY);
    setChatPanelWidthPercent(storedWorkspaceUi?.chatPanelWidthPercent ?? DEFAULT_CHAT_PANEL_PERCENT);
    setWorkspaceTabs(storedWorkspaceUi?.workspaceTabs ?? []);
    setActiveWorkspaceTabId(storedWorkspaceUi?.activeWorkspaceTabId ?? null);
  }, [workspaceUiStorageKey]);

  useEffect(() => {
    writeStoredWorkspaceUiState(workspaceUiStorageKey, {
      panelVisibility,
      chatPanelWidthPercent,
      workspaceTabs,
      activeWorkspaceTabId,
    });
  }, [workspaceUiStorageKey, panelVisibility, chatPanelWidthPercent, workspaceTabs, activeWorkspaceTabId]);

  return {
    workspaceUiStorageKey,
    panelVisibility,
    setPanelVisibility,
    chatPanelWidthPercent,
    setChatPanelWidthPercent,
    isResizingChat,
    setIsResizingChat,
    workspaceTabs,
    setWorkspaceTabs,
    activeWorkspaceTabId,
    setActiveWorkspaceTabId,
    setPanelOpen,
    restoreWorkspaceUiFromStorage,
  };
}

export function useProjectWorkspaceHeaderToggles({
  activeView,
  hasFrameworkSelection,
  isViewer,
  panelVisibility,
  workspaceOpen,
  chatOpen,
  setPanelOpen,
}: HeaderToggleConfig & {
  setPanelOpen: (view: PanelView, panel: 'workspace' | 'chat', open: boolean) => void;
}) {
  const isChatPrimaryMode = activeView === 'framework' && !hasFrameworkSelection;
  const workspaceToggleEnabled = !isViewer && (
    activeView === 'overview'
    || activeView === 'framework'
    || activeView === 'assessments'
    || activeView === 'assumptions'
  );
  const chatToggleEnabled =
    activeView === 'assessments'
    || activeView === 'overview'
    || activeView === 'framework'
    || activeView === 'assumptions';
  const workspaceToggleActive = isChatPrimaryMode ? false : workspaceOpen;
  const chatToggleActive = isChatPrimaryMode ? true : chatOpen;
  const workspaceToggleLocked = workspaceToggleActive && !chatToggleActive;
  const chatToggleLocked = chatToggleActive && !workspaceToggleActive;

  const workspaceHeaderToggle = {
    active: workspaceToggleActive,
    disabled: !workspaceToggleEnabled || workspaceToggleLocked,
    onClick: () => {
      if (!workspaceToggleEnabled || workspaceToggleLocked) return;
      if (activeView === 'assessments') {
        setPanelOpen('assessments', 'workspace', !panelVisibility.assessments.workspace);
        return;
      }
      if (activeView === 'overview') {
        setPanelOpen('overview', 'workspace', !panelVisibility.overview.workspace);
        return;
      }
      if (activeView === 'framework' && hasFrameworkSelection) {
        setPanelOpen('framework', 'workspace', !panelVisibility.framework.workspace);
        return;
      }
      if (activeView === 'assumptions') {
        setPanelOpen('assumptions', 'workspace', !panelVisibility.assumptions.workspace);
      }
    },
    title: !workspaceToggleEnabled
      ? 'Workspace unavailable'
      : workspaceToggleLocked
        ? 'Workspace must stay open'
        : workspaceToggleActive
          ? 'Hide workspace'
          : 'Show workspace',
    icon: 'workspace' as const,
  };

  const chatHeaderToggle = {
    active: chatToggleActive,
    disabled: !chatToggleEnabled || chatToggleLocked,
    onClick: () => {
      if (!chatToggleEnabled || chatToggleLocked) return;
      if (activeView === 'assessments') {
        setPanelOpen('assessments', 'chat', !panelVisibility.assessments.chat);
        return;
      }
      if (activeView === 'overview') {
        setPanelOpen('overview', 'chat', !panelVisibility.overview.chat);
        return;
      }
      if (activeView === 'framework' && hasFrameworkSelection) {
        setPanelOpen('framework', 'chat', !panelVisibility.framework.chat);
        return;
      }
      if (activeView === 'assumptions') {
        setPanelOpen('assumptions', 'chat', !panelVisibility.assumptions.chat);
      }
    },
    title: !chatToggleEnabled
      ? 'Chat unavailable'
      : chatToggleLocked
        ? 'Chat must stay open'
        : chatToggleActive
          ? 'Hide chat'
          : 'Show chat',
    icon: 'chat' as const,
  };

  return {
    isChatPrimaryMode,
    workspaceHeaderToggle,
    chatHeaderToggle,
  };
}
