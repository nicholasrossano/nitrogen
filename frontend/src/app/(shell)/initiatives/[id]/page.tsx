'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useShallow } from 'zustand/react/shallow';

import { ProjectHeader } from '@/components/editor';
import type { EditorWidget, WorkspacePanelTab } from '@/components/editor';
import { ProjectWorkspaceEditorPanel } from '@/components/editor/ProjectWorkspaceEditorPanel';
import type { WorkspaceLaunchMode } from '@/components/editor/WorkspaceHub';
import { ProjectOnboardingHeader } from '@/components/core-chat/ProjectOnboardingHeader';
import { ProjectStandaloneChatView } from '@/components/core-chat/ProjectStandaloneChatView';
import { FrameworkPlanView } from '@/components/framework/FrameworkPlanView';
import { ALL_MODULES, MODULE_CATEGORIES } from '@/components/chat/ModulePicker';
import { ModuleWorkspace } from '@/components/modules/ModuleWorkspace';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ProjectChatTabsPanel } from '@/components/core-chat/ProjectChatTabsPanel';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import type { PlanWorkspaceInspectorState } from '@/components/plan-workspace';
import { ShellPageHeader } from '@/components/ui';
import { useShellNav } from '@/components/ui/ShellContext';
import type { NavItem } from '@/components/ui/SideDrawer';
import { PageLoader } from '@/components/ui/PageLoader';
import { api, type ModuleInstance } from '@/lib/api';
import { DIAGRAM_ACCENT_COLOR } from '@/lib/diagramAccent';
import { importFromDriveViaPicker } from '@/lib/driveImport';
import { useGoogleDriveStore } from '@/stores/googleDriveStore';
import { useInitiativeStore } from '@/stores/initiativeStore';

const ProjectFilesView = dynamic(() => import('@/components/files').then((m) => ({ default: m.ProjectFilesView })), { ssr: false });
const MIN_CHAT_PANEL_PERCENT = 20;
const MAX_CHAT_PANEL_PERCENT = 60;
const DEFAULT_CHAT_PANEL_PERCENT = 30;

type InitiativeView = 'overview' | 'modules' | 'framework' | 'files';

function viewFromSearchParam(viewParam: string | null): InitiativeView {
  if (viewParam === 'overview' || viewParam === 'research' || viewParam === 'explore') return 'overview';
  if (viewParam === 'framework' || viewParam === 'plan') return 'framework';
  if (viewParam === 'workspace' || viewParam === 'modules') return 'modules';
  if (viewParam === 'files') return 'files';
  return 'overview';
}

function makeDocumentTabId(citation: ResearchPanelCitation): string {
  return `document-${citation.evidence_doc_id}-${citation.chunk_id ?? 'root'}`;
}

function isDocumentTab(tab: WorkspacePanelTab | null): tab is Extract<WorkspacePanelTab, { kind: 'document' }> {
  return tab?.kind === 'document';
}

interface PendingDeepDiveRequest {
  requestId: string;
  state: PlanWorkspaceInspectorState;
}

interface StoredInitiativeWorkspaceUiState {
  panelVisibility: {
    overview: { workspace: boolean; chat: boolean };
    modules: { workspace: boolean; chat: boolean };
    framework: { workspace: boolean; chat: boolean };
  };
  chatPanelWidthPercent: number;
  workspaceTabs: WorkspacePanelTab[];
  activeWorkspaceTabId: string | null;
}

const DEFAULT_PANEL_VISIBILITY: StoredInitiativeWorkspaceUiState['panelVisibility'] = {
  overview: { workspace: true, chat: false },
  modules: { workspace: true, chat: false },
  framework: { workspace: true, chat: false },
};

function readStoredWorkspaceUiState(storageKey: string): StoredInitiativeWorkspaceUiState | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredInitiativeWorkspaceUiState>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.panelVisibility || !parsed.workspaceTabs) return null;

    const tabs = Array.isArray(parsed.workspaceTabs)
      ? parsed.workspaceTabs.filter(
          (tab): tab is WorkspacePanelTab =>
            Boolean(tab) &&
            typeof tab === 'object' &&
            typeof (tab as { id?: unknown }).id === 'string' &&
            typeof (tab as { title?: unknown }).title === 'string' &&
            typeof (tab as { kind?: unknown }).kind === 'string',
        )
      : [];

    const parsedWidth = Number(parsed.chatPanelWidthPercent);
    const clampedWidth = Number.isFinite(parsedWidth)
      ? Math.min(MAX_CHAT_PANEL_PERCENT, Math.max(MIN_CHAT_PANEL_PERCENT, parsedWidth))
      : DEFAULT_CHAT_PANEL_PERCENT;

    const activeWorkspaceTabId =
      typeof parsed.activeWorkspaceTabId === 'string' &&
      tabs.some((tab) => tab.id === parsed.activeWorkspaceTabId)
        ? parsed.activeWorkspaceTabId
        : null;

    return {
      panelVisibility: parsed.panelVisibility,
      chatPanelWidthPercent: clampedWidth,
      workspaceTabs: tabs,
      activeWorkspaceTabId,
    };
  } catch {
    return null;
  }
}

function writeStoredWorkspaceUiState(storageKey: string, state: StoredInitiativeWorkspaceUiState) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Ignore private mode / quota errors.
  }
}

function inspectorRequestKey(state: PlanWorkspaceInspectorState): string {
  return `${state.groupName}::${state.item.id}`;
}

function InitiativePageContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initiativeId = params.id as string;
  const workspaceUiStorageKey = `nitrogen_initiative_workspace_ui_${initiativeId}`;
  const frameworkChatTabsStorageKey = `nitrogen_framework_chat_tabs_${initiativeId}`;

  const workspaceContainerRef = useRef<HTMLDivElement>(null);
  const chatSendRef = useRef<((content: string, toolHint?: string) => void) | null>(null);

  const viewParam = searchParams.get('view');
  const viewFromUrl = viewFromSearchParam(viewParam);
  const initialWorkspaceUiRef = useRef<StoredInitiativeWorkspaceUiState | null>(null);
  if (!initialWorkspaceUiRef.current) {
    initialWorkspaceUiRef.current = readStoredWorkspaceUiState(workspaceUiStorageKey);
  }

  const [activeView, setActiveView] = useState<InitiativeView>(viewFromUrl);
  const [panelVisibility, setPanelVisibility] = useState(
    initialWorkspaceUiRef.current?.panelVisibility ?? DEFAULT_PANEL_VISIBILITY,
  );
  const [chatPanelWidthPercent, setChatPanelWidthPercent] = useState(
    initialWorkspaceUiRef.current?.chatPanelWidthPercent ?? DEFAULT_CHAT_PANEL_PERCENT,
  );
  const [isResizingChat, setIsResizingChat] = useState(false);

  const [pageReady, setPageReady] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [chromeReady, setChromeReady] = useState(false);
  const [planViewReady, setPlanViewReady] = useState(true);
  const [showPlanOverlay, setShowPlanOverlay] = useState(false);

  const [frameworkDeepDiveRequest, setFrameworkDeepDiveRequest] = useState<PendingDeepDiveRequest | null>(null);
  const [modulesDeepDiveRequest, setModulesDeepDiveRequest] = useState<PendingDeepDiveRequest | null>(null);
  const [chatEditorWidgets, setChatEditorWidgets] = useState<EditorWidget[]>([]);
  const [workspaceLaunchMode, setWorkspaceLaunchMode] = useState<WorkspaceLaunchMode>('idle');
  const [pendingChatToOpen, setPendingChatToOpen] = useState<{ chatId: string; title?: string | null } | null>(null);
  const [pendingOverviewAutoSend, setPendingOverviewAutoSend] = useState<{
    requestId: string;
    content: string;
    toolHint?: string;
  } | null>(null);
  const [preferArtifactsTab, setPreferArtifactsTab] = useState(false);
  const [researchLandingResetSignal, setResearchLandingResetSignal] = useState(0);
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspacePanelTab[]>(
    initialWorkspaceUiRef.current?.workspaceTabs ?? [],
  );
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState<string | null>(
    initialWorkspaceUiRef.current?.activeWorkspaceTabId ?? null,
  );
  const [frameworkActiveModule, setFrameworkActiveModule] = useState<{
    instanceId: string;
    moduleId: string;
    title: string;
  } | null>(null);
  const [frameworkModuleInstances, setFrameworkModuleInstances] = useState<ModuleInstance[]>([]);
  const [frameworkPlannedModuleIds, setFrameworkPlannedModuleIds] = useState<string[]>([]);
  const [frameworkModulesLoading, setFrameworkModulesLoading] = useState(false);
  const onboardingSeenRef = useRef(false);
  const frameworkDeepDiveRef = useRef<{ key: string; requestId: string } | null>(null);
  const modulesDeepDiveRef = useRef<{ key: string; requestId: string } | null>(null);

  const {
    initiative,
    projectPlan,
    projectMaterials,
    driveLinkedFiles,
    loading,
    error,
  } = useInitiativeStore(useShallow((s) => ({
    initiative: s.initiative,
    projectPlan: s.projectPlan,
    projectMaterials: s.projectMaterials,
    driveLinkedFiles: s.driveLinkedFiles,
    loading: s.loading,
    error: s.error,
  })));

  const loadInitiative = useInitiativeStore((s) => s.loadInitiative);
  const loadEvidence = useInitiativeStore((s) => s.loadEvidence);
  const loadMaterials = useInitiativeStore((s) => s.loadMaterials);
  const loadProjectPlan = useInitiativeStore((s) => s.loadProjectPlan);
  const loadDriveLinkedFiles = useInitiativeStore((s) => s.loadDriveLinkedFiles);
  const syncDriveFiles = useInitiativeStore((s) => s.syncDriveFiles);
  const importFromDrive = useInitiativeStore((s) => s.importFromDrive);
  const updateTitle = useInitiativeStore((s) => s.updateTitle);
  const uploadMaterial = useInitiativeStore((s) => s.uploadMaterial);
  const deleteMaterial = useInitiativeStore((s) => s.deleteMaterial);
  const reset = useInitiativeStore((s) => s.reset);

  const isViewer = initiative?.shared_role === 'viewer';
  const getDriveAccessToken = useGoogleDriveStore((s) => s.getAccessToken);
  const driveConnected = useGoogleDriveStore((s) => s.connected);
  const connectDrive = useGoogleDriveStore((s) => s.connect);

  const hasProjectPlan = Boolean(projectPlan);
  const isOnboarding = Boolean(initiative && !isViewer && !hasProjectPlan);
  const frameworkProgress = useMemo(
    () => {
      const categoryForModuleId = new Map<string, string>();
      MODULE_CATEGORIES.forEach((category) => {
        category.moduleIds.forEach((moduleId) => categoryForModuleId.set(moduleId, category.id));
      });

      const approvedModuleIds = new Set(
        frameworkModuleInstances
          .filter((instance) => instance.is_plan_complete === true)
          .map((instance) => instance.module_id),
      );

      const segments = MODULE_CATEGORIES.map((category) => {
        const plannedInCategory = frameworkPlannedModuleIds.filter(
          (moduleId) => categoryForModuleId.get(moduleId) === category.id,
        );
        const approvedCount = plannedInCategory.filter((moduleId) => approvedModuleIds.has(moduleId)).length;
        return {
          id: category.id,
          label: category.name,
          color: DIAGRAM_ACCENT_COLOR,
          completed: approvedCount,
          total: plannedInCategory.length,
        };
      }).filter((segment) => segment.total > 0);

      const total = segments.reduce((sum, segment) => sum + segment.total, 0);
      const completed = segments.reduce((sum, segment) => sum + segment.completed, 0);
      if (total === 0) return null;

      return {
        completed,
        total,
        percentage: Math.round((completed / total) * 100),
        segments,
      };
    },
    [frameworkModuleInstances, frameworkPlannedModuleIds],
  );
  const frameworkPlanModuleOptions = useMemo(
    () => frameworkPlannedModuleIds
      .map((id) => ALL_MODULES.find((m) => m.id === id))
      .filter((m): m is (typeof ALL_MODULES)[number] => Boolean(m)),
    [frameworkPlannedModuleIds],
  );
  const activeWorkspaceTab = useMemo(
    () => workspaceTabs.find((tab) => tab.id === activeWorkspaceTabId) ?? null,
    [workspaceTabs, activeWorkspaceTabId],
  );
  const activeModuleContext = useMemo(() => {
    if (activeWorkspaceTab?.kind === 'module') {
      return {
        instanceId: activeWorkspaceTab.instanceId,
        moduleId: activeWorkspaceTab.moduleId,
        title: activeWorkspaceTab.title,
      };
    }
    if (activeWorkspaceTab?.kind === 'decision-log' && activeWorkspaceTab.moduleId) {
      return {
        instanceId: activeWorkspaceTab.moduleInstanceId,
        moduleId: activeWorkspaceTab.moduleId,
        title: activeWorkspaceTab.title,
      };
    }
    return null;
  }, [activeWorkspaceTab]);
  const frameworkModuleContext = useMemo(() => {
    if (!frameworkActiveModule) return null;
    return {
      instanceId: frameworkActiveModule.instanceId,
      moduleId: frameworkActiveModule.moduleId,
      title: frameworkActiveModule.title,
    };
  }, [frameworkActiveModule]);
  const visibleWorkspaceTabs = useMemo(
    () => (activeView === 'modules' ? workspaceTabs : workspaceTabs.filter((tab) => tab.kind === 'document')),
    [activeView, workspaceTabs],
  );
  const visibleWorkspaceActiveTabId = useMemo(
    () => (visibleWorkspaceTabs.some((tab) => tab.id === activeWorkspaceTabId) ? activeWorkspaceTabId : null),
    [visibleWorkspaceTabs, activeWorkspaceTabId],
  );
  const showTabbedWorkspace =
    activeView === 'modules' || (activeView === 'framework' && isDocumentTab(activeWorkspaceTab));
  const overviewWorkspaceOpen = activeView === 'overview' && panelVisibility.overview.workspace;
  const overviewChatOpen = activeView === 'overview' && panelVisibility.overview.chat;
  const modulesWorkspaceOpen = activeView === 'modules' && panelVisibility.modules.workspace;
  const modulesChatOpen = activeView === 'modules' && panelVisibility.modules.chat;
  const frameworkWorkspaceOpen =
    activeView === 'framework' && (!hasProjectPlan || panelVisibility.framework.workspace);
  const frameworkChatOpen = activeView === 'framework' && hasProjectPlan && panelVisibility.framework.chat;
  const workspaceOpen = overviewWorkspaceOpen || modulesWorkspaceOpen || frameworkWorkspaceOpen;
  const chatOpen = overviewChatOpen || modulesChatOpen || frameworkChatOpen;
  const sideChatOpen = overviewChatOpen || modulesChatOpen || frameworkChatOpen;
  const sideChatTabsStorageKey = `nitrogen_side_chat_tabs_${initiativeId}`;
  const showPrimaryPanel = activeView === 'files' || workspaceOpen;
  const isChatPrimaryMode = activeView === 'framework' && !hasProjectPlan;
  const workspaceToggleEnabled = !isViewer && (
    activeView === 'overview' || activeView === 'framework' || activeView === 'modules'
  );
  const chatToggleEnabled =
    activeView === 'modules' || activeView === 'overview' || activeView === 'framework';
  const workspaceToggleActive = isChatPrimaryMode ? false : workspaceOpen;
  const chatToggleActive = isChatPrimaryMode ? true : chatOpen;
  const workspaceToggleLocked = workspaceToggleActive && !chatToggleActive;
  const chatToggleLocked = chatToggleActive && !workspaceToggleActive;

  const setPanelOpen = useCallback(
    (view: 'overview' | 'modules' | 'framework', panel: 'workspace' | 'chat', open: boolean) => {
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

  const workspaceHeaderToggle = {
    active: workspaceToggleActive,
    disabled: !workspaceToggleEnabled || workspaceToggleLocked,
    onClick: () => {
      if (!workspaceToggleEnabled || workspaceToggleLocked) return;
      if (activeView === 'modules') {
        setPanelOpen('modules', 'workspace', !panelVisibility.modules.workspace);
        return;
      }
      if (activeView === 'overview') {
        setPanelOpen('overview', 'workspace', !panelVisibility.overview.workspace);
        return;
      }
      if (activeView === 'framework' && hasProjectPlan) {
        setPanelOpen('framework', 'workspace', !panelVisibility.framework.workspace);
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
      if (activeView === 'modules') {
        setPanelOpen('modules', 'chat', !panelVisibility.modules.chat);
        return;
      }
      if (activeView === 'overview') {
        setPanelOpen('overview', 'chat', !panelVisibility.overview.chat);
        return;
      }
      if (activeView === 'framework' && hasProjectPlan) {
        setPanelOpen('framework', 'chat', !panelVisibility.framework.chat);
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

  useEffect(() => {
    setActiveView((prev) => (prev === viewFromUrl ? prev : viewFromUrl));
  }, [viewFromUrl]);

  useEffect(() => {
    if (viewParam === 'plan') {
      router.replace(`/initiatives/${initiativeId}?view=framework`);
    }
  }, [viewParam, router, initiativeId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail ?? {};
      if (detail._workspaceForwarded) return;
      if (activeView !== 'modules' || panelVisibility.modules.chat) return;

      setPanelOpen('modules', 'chat', true);
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('nitrogen:draft', {
            detail: { ...detail, _workspaceForwarded: true },
          }),
        );
      }, 75);
    };

    window.addEventListener('nitrogen:draft', handler);
    return () => window.removeEventListener('nitrogen:draft', handler);
  }, [activeView, panelVisibility.modules.chat, setPanelOpen]);

  const handleFilesViewDriveImport = useCallback(async () => {
    await importFromDriveViaPicker({
      initiativeId,
      driveConnected,
      connectDrive,
      getDriveAccessToken,
      importFromDrive,
    });
  }, [driveConnected, connectDrive, getDriveAccessToken, importFromDrive, initiativeId]);

  const handlePlanReady = useCallback(() => setPlanViewReady(true), []);

  const loadFrameworkModuleInstances = useCallback(async (targetInitiativeId: string) => {
    setFrameworkModulesLoading(true);
    try {
      const instances = await api.listModuleInstances(targetInitiativeId);
      setFrameworkModuleInstances(instances);
    } catch {
      setFrameworkModuleInstances([]);
    } finally {
      setFrameworkModulesLoading(false);
    }
  }, []);

  useShellNav(useCallback((item: NavItem): boolean => {
    if (item === 'home') {
      router.push('/');
      return true;
    }
    if (item === 'research') {
      if (activeView === 'overview') {
        setResearchLandingResetSignal((prev) => prev + 1);
      }
      setPanelOpen('overview', 'workspace', true);
      setActiveView('overview');
      router.replace(`/initiatives/${initiativeId}?view=overview`);
      return true;
    }
    if (item === 'workspace') {
      setPanelOpen('modules', 'workspace', true);
      // Drawer click should always land on the module hub.
      setWorkspaceLaunchMode('open');
      setActiveWorkspaceTabId(null);
      setActiveView('modules');
      router.replace(`/initiatives/${initiativeId}?view=modules`);
      return true;
    }
    if (item === 'files') {
      setActiveView('files');
      router.replace(`/initiatives/${initiativeId}?view=files`);
      return true;
    }
    if (item === 'plan') {
      setPlanViewReady(false);
      setShowPlanOverlay(true);
      loadProjectPlan(initiativeId).finally(handlePlanReady);
      setActiveView('framework');
      router.replace(`/initiatives/${initiativeId}?view=framework`);
      return true;
    }
    return false;
  }, [router, initiativeId, loadProjectPlan, handlePlanReady, activeView, setPanelOpen]));

  useEffect(() => {
    if (isViewer && (activeView === 'overview' || activeView === 'modules')) {
      setActiveView('framework');
      router.replace(`/initiatives/${initiativeId}?view=framework`);
    }
  }, [isViewer, activeView, initiativeId, router]);

  useEffect(() => {
    if (!initiative) return;
    if (isOnboarding && activeView !== 'overview') {
      setActiveView('overview');
      router.replace(`/initiatives/${initiativeId}?view=overview`);
    }
  }, [initiative, isOnboarding, activeView, initiativeId, router]);

  useEffect(() => {
    if (!initiative) return;
    if (isOnboarding) {
      onboardingSeenRef.current = true;
      return;
    }
    if (!hasProjectPlan || !onboardingSeenRef.current || isViewer) return;
    onboardingSeenRef.current = false;
    setPlanViewReady(true);
    setShowPlanOverlay(false);
    setActiveView('framework');
    router.replace(`/initiatives/${initiativeId}?view=framework`);
  }, [initiative, hasProjectPlan, isOnboarding, isViewer, initiativeId, router]);

  useEffect(() => {
    if (!initiativeId) return;
    const storedWorkspaceUi = readStoredWorkspaceUiState(workspaceUiStorageKey);

    setPanelVisibility(storedWorkspaceUi?.panelVisibility ?? DEFAULT_PANEL_VISIBILITY);
    setChatPanelWidthPercent(storedWorkspaceUi?.chatPanelWidthPercent ?? DEFAULT_CHAT_PANEL_PERCENT);
    setWorkspaceTabs(storedWorkspaceUi?.workspaceTabs ?? []);
    setActiveWorkspaceTabId(storedWorkspaceUi?.activeWorkspaceTabId ?? null);
    setFrameworkActiveModule(null);
    setFrameworkModuleInstances([]);
    setFrameworkPlannedModuleIds([]);
    setFrameworkModulesLoading(false);
    setFrameworkDeepDiveRequest(null);
    setModulesDeepDiveRequest(null);
    frameworkDeepDiveRef.current = null;
    modulesDeepDiveRef.current = null;
    setChatEditorWidgets([]);
    setWorkspaceLaunchMode('idle');
    setPendingChatToOpen(null);
    setPendingOverviewAutoSend(null);
    setPreferArtifactsTab(false);
    setPageReady(false);
    setChromeReady(false);
    setShowOverlay(true);
    setShowPlanOverlay(false);
    setPlanViewReady(true);
    onboardingSeenRef.current = false;

    reset();
    const initiativeLoad = loadInitiative(initiativeId);
    initiativeLoad.finally(() => setChromeReady(true));
    initiativeLoad.finally(() => setPageReady(true));

    loadEvidence(initiativeId);
    loadMaterials(initiativeId);
    loadFrameworkModuleInstances(initiativeId);
    loadDriveLinkedFiles(initiativeId).then(() => {
      syncDriveFiles(initiativeId).catch(() => {});
    });
  }, [initiativeId, workspaceUiStorageKey, reset, loadInitiative, loadEvidence, loadMaterials, loadDriveLinkedFiles, syncDriveFiles, loadFrameworkModuleInstances]);

  useEffect(() => {
    if (activeView !== 'framework') return;
    if (!initiativeId) return;
    loadFrameworkModuleInstances(initiativeId);
  }, [activeView, initiativeId, loadFrameworkModuleInstances]);

  useEffect(() => {
    if (!initiative) return;
    if (initiative.selected_tools !== null && initiative.selected_tools !== undefined) {
      setFrameworkPlannedModuleIds(Array.from(new Set(initiative.selected_tools)));
      return;
    }
    setFrameworkPlannedModuleIds([]);
  }, [initiativeId, initiative?.selected_tools]);

  useEffect(() => {
    if (!initiative) return;
    if (initiative.selected_tools !== null && initiative.selected_tools !== undefined) return;
    if (frameworkPlannedModuleIds.length > 0) return;
    if (frameworkModuleInstances.length === 0) return;
    const inferred = Array.from(new Set(frameworkModuleInstances.map((instance) => instance.module_id)));
    setFrameworkPlannedModuleIds(inferred);
  }, [initiative, frameworkModuleInstances, frameworkPlannedModuleIds.length]);

  useEffect(() => {
    writeStoredWorkspaceUiState(workspaceUiStorageKey, {
      panelVisibility,
      chatPanelWidthPercent,
      workspaceTabs,
      activeWorkspaceTabId,
    });
  }, [workspaceUiStorageKey, panelVisibility, chatPanelWidthPercent, workspaceTabs, activeWorkspaceTabId]);

  useEffect(() => {
    if (!pageReady) return;
    const timer = window.setTimeout(() => setShowOverlay(false), 350);
    return () => window.clearTimeout(timer);
  }, [pageReady]);

  useEffect(() => {
    if (!planViewReady || !showPlanOverlay) return;
    const timer = window.setTimeout(() => setShowPlanOverlay(false), 350);
    return () => window.clearTimeout(timer);
  }, [planViewReady, showPlanOverlay]);

  useEffect(() => {
    const hasArtifactsTab = workspaceTabs.some((tab) => tab.id === 'chat-artifacts');
    if (chatEditorWidgets.length > 0 && !hasArtifactsTab) {
      setWorkspaceTabs((prev) => [...prev, { id: 'chat-artifacts', kind: 'artifacts', title: 'Chat Outputs' }]);
      return;
    }

    if (chatEditorWidgets.length === 0 && hasArtifactsTab) {
      setWorkspaceTabs((prev) => prev.filter((tab) => tab.id !== 'chat-artifacts'));
      setActiveWorkspaceTabId((current) => {
        if (current !== 'chat-artifacts') return current;
        if (activeView === 'modules') {
          const fallbackTabs = workspaceTabs.filter((tab) => tab.id !== 'chat-artifacts');
          return fallbackTabs[0]?.id ?? null;
        }
        const fallbackDocument = workspaceTabs.find(
          (tab) => tab.id !== 'chat-artifacts' && tab.kind === 'document',
        );
        return fallbackDocument?.id ?? null;
      });
    }
  }, [chatEditorWidgets.length, workspaceTabs, activeView]);

  useEffect(() => {
    if (!preferArtifactsTab || !chatEditorWidgets.length) return;
    setActiveWorkspaceTabId('chat-artifacts');
    setPreferArtifactsTab(false);
  }, [preferArtifactsTab, chatEditorWidgets.length]);

  useEffect(() => {
    if (activeView !== 'modules') return;
    if (activeWorkspaceTabId !== null) return;
    if (workspaceTabs.length === 0) return;
    setActiveWorkspaceTabId(workspaceTabs[0].id);
  }, [activeView, activeWorkspaceTabId, workspaceTabs]);

  const openWorkspaceTab = useCallback((tab: WorkspacePanelTab) => {
    setWorkspaceTabs((prev) => (prev.some((existingTab) => existingTab.id === tab.id) ? prev : [...prev, tab]));
    setActiveWorkspaceTabId(tab.id);
  }, []);

  const handleOpenWorkspaceModule = useCallback(
    (module: {
      instanceId: string;
      moduleId: string;
      title?: string | null;
      chatId?: string | null;
      chatTitle?: string | null;
      openChatPanel?: boolean;
    }) => {
      const openChatPanel = module.openChatPanel ?? true;
      setWorkspaceLaunchMode('idle');
      setPanelOpen('modules', 'workspace', true);
      setPanelOpen('modules', 'chat', openChatPanel);
      loadFrameworkModuleInstances(initiativeId);
      if (openChatPanel && module.chatId) {
        setPendingChatToOpen({
          chatId: module.chatId,
          title: module.chatTitle || module.title || null,
        });
      }
      setActiveView('modules');
      router.replace(`/initiatives/${initiativeId}?view=modules`);
      openWorkspaceTab({
        id: `module-${module.instanceId}`,
        kind: 'module',
        title: module.title || module.moduleId.replace(/_/g, ' '),
        instanceId: module.instanceId,
        moduleId: module.moduleId,
      });
    },
    [initiativeId, openWorkspaceTab, router, setPanelOpen, loadFrameworkModuleInstances],
  );

  const openWorkspaceDocument = useCallback((citation: ResearchPanelCitation) => {
    openWorkspaceTab({
      id: makeDocumentTabId(citation),
      kind: 'document',
      title: citation.source_title || 'Document',
      citation,
    });
  }, [openWorkspaceTab]);

  const openDecisionLogTab = useCallback(
    (context: { instanceId: string; moduleId: string; title: string }) => {
      setActiveView('modules');
      router.replace(`/initiatives/${initiativeId}?view=modules`);
      openWorkspaceTab({
        id: `decision-log-${context.instanceId}`,
        kind: 'decision-log',
        title: 'Decision Log',
        moduleInstanceId: context.instanceId,
        moduleId: context.moduleId,
      });
    },
    [initiativeId, openWorkspaceTab, router],
  );

  const exportDecisionLog = useCallback(
    async (context: { instanceId: string; moduleId: string; title: string }) => {
      const { blob, filename } = await api.exportModuleDecisionLogXlsx(context.instanceId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    [],
  );

  const handleOpenFrameworkModule = useCallback((module: {
    instanceId: string;
    moduleId: string;
    title?: string | null;
  }) => {
    setFrameworkActiveModule({
      instanceId: module.instanceId,
      moduleId: module.moduleId,
      title: module.title || module.moduleId.replace(/_/g, ' '),
    });
  }, []);

  const handleCreateModuleInstanceInModulesView = useCallback(async (
    moduleId: string,
    moduleName: string,
  ) => {
    const instance = await api.createModuleInstance(initiativeId, moduleId);
    setFrameworkModuleInstances((prev) => [...prev, instance]);
    handleOpenWorkspaceModule({
      instanceId: instance.id,
      moduleId: instance.module_id,
      title: moduleName,
      openChatPanel: false,
    });
  }, [initiativeId, handleOpenWorkspaceModule]);

  const handleOpenExistingModuleInstanceInModulesView = useCallback(async (
    instance: ModuleInstance,
  ) => {
    handleOpenWorkspaceModule({
      instanceId: instance.id,
      moduleId: instance.module_id,
      title: instance.title || instance.module_id.replace(/_/g, ' '),
      openChatPanel: false,
    });
  }, [handleOpenWorkspaceModule]);

  const handleAddModuleToFrameworkPlan = useCallback(async (moduleId: string) => {
    const next = Array.from(new Set([...frameworkPlannedModuleIds, moduleId]));
    const response = await api.selectTools(initiativeId, next);
    setFrameworkPlannedModuleIds(response.selected_tools);
  }, [frameworkPlannedModuleIds, initiativeId]);

  const handleRemoveModuleFromFrameworkPlan = useCallback(async (moduleId: string) => {
    const next = frameworkPlannedModuleIds.filter((id) => id !== moduleId);
    const response = await api.selectTools(initiativeId, next);
    setFrameworkPlannedModuleIds(response.selected_tools);
  }, [frameworkPlannedModuleIds, initiativeId]);

  const closeWorkspaceTab = useCallback((tabId: string) => {
    setWorkspaceTabs((prev) => {
      const nextTabs = prev.filter((tab) => tab.id !== tabId);
      setActiveWorkspaceTabId((current) => {
        if (current !== tabId) return current;
        if (activeView === 'modules') {
          return nextTabs[0]?.id ?? null;
        }
        const nextDocument = nextTabs.find((tab) => tab.kind === 'document');
        return nextDocument?.id ?? null;
      });
      return nextTabs;
    });
  }, [activeView]);

  const handleChatEditorWidgetsChange = useCallback((widgets: EditorWidget[]) => {
    setChatEditorWidgets(widgets);
  }, []);

  const handleChatMouseMove = useCallback((event: MouseEvent) => {
    if (!isResizingChat || !workspaceContainerRef.current) return;
    const rect = workspaceContainerRef.current.getBoundingClientRect();
    const nextPercent = ((rect.right - event.clientX) / rect.width) * 100;
    setChatPanelWidthPercent(
      Math.min(MAX_CHAT_PANEL_PERCENT, Math.max(MIN_CHAT_PANEL_PERCENT, nextPercent)),
    );
  }, [isResizingChat]);

  const handleChatMouseUp = useCallback(() => {
    setIsResizingChat(false);
  }, []);

  useEffect(() => {
    if (isResizingChat) {
      document.addEventListener('mousemove', handleChatMouseMove);
      document.addEventListener('mouseup', handleChatMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleChatMouseMove);
      document.removeEventListener('mouseup', handleChatMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingChat, handleChatMouseMove, handleChatMouseUp]);

  const handleFrameworkInspectorStateChange = useCallback((state: PlanWorkspaceInspectorState | null) => {
    if (!state) {
      frameworkDeepDiveRef.current = null;
      setFrameworkDeepDiveRequest(null);
      return;
    }

    const key = inspectorRequestKey(state);
    const existing = frameworkDeepDiveRef.current;
    const requestId = existing?.key === key
      ? existing.requestId
      : `framework-deep-dive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    frameworkDeepDiveRef.current = { key, requestId };
    setFrameworkDeepDiveRequest({ requestId, state });
    if (existing?.key !== key) {
      setPanelOpen('framework', 'chat', true);
    }
  }, [setPanelOpen]);

  const handleModuleInspectorStateChange = useCallback((state: PlanWorkspaceInspectorState | null) => {
    if (!state) {
      modulesDeepDiveRef.current = null;
      setModulesDeepDiveRequest(null);
      return;
    }

    const key = inspectorRequestKey(state);
    const existing = modulesDeepDiveRef.current;
    const requestId = existing?.key === key
      ? existing.requestId
      : `module-deep-dive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    modulesDeepDiveRef.current = { key, requestId };
    setModulesDeepDiveRequest({ requestId, state });
    if (existing?.key !== key) {
      setPanelOpen('modules', 'chat', true);
    }
  }, [setPanelOpen]);

  const handleTitleUpdate = useCallback((title: string) => {
    updateTitle(initiativeId, title);
  }, [initiativeId, updateTitle]);

  const renderPlanOverlay = showPlanOverlay ? (
    <div
      className={`absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-surface/95 backdrop-blur-xl transition-opacity duration-300 ${planViewReady ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
    >
      <PageLoader label="" />
    </div>
  ) : null;

  const primaryWorkspaceContent = (() => {
    if (activeView === 'files') {
      return (
        <ProjectFilesView
          initiativeId={initiativeId}
          materials={projectMaterials}
          onDeleteMaterial={isViewer ? undefined : deleteMaterial}
          onUploadFile={isViewer ? undefined : (file) => uploadMaterial(initiativeId, file)}
          onImportFromDrive={isViewer ? undefined : handleFilesViewDriveImport}
          driveLinkedFiles={driveLinkedFiles}
          onSyncDriveFiles={isViewer ? undefined : async () => {
            await syncDriveFiles(initiativeId);
          }}
        />
      );
    }

    if (showTabbedWorkspace) {
      return (
        <ProjectWorkspaceEditorPanel
          initiativeId={initiativeId}
          tabs={visibleWorkspaceTabs}
          activeTabId={visibleWorkspaceActiveTabId}
          onActiveTabChange={setActiveWorkspaceTabId}
          onOpenTab={openWorkspaceTab}
          onCloseTab={closeWorkspaceTab}
          chatWidgets={chatEditorWidgets}
          workspaceLaunchMode={workspaceLaunchMode}
          onWorkspaceLaunchModeHandled={() => setWorkspaceLaunchMode('idle')}
          showModuleActions={activeView === 'modules'}
          frameworkPlanModules={activeView === 'modules' ? frameworkPlanModuleOptions : undefined}
          onNewModule={activeView === 'modules' ? handleCreateModuleInstanceInModulesView : undefined}
          onSendToChat={(content, toolHint) => {
            setPanelOpen('modules', 'chat', true);
            chatSendRef.current?.(content, toolHint);
          }}
          onOpenChatSession={(chat) => {
            setPanelOpen('modules', 'chat', true);
            setPreferArtifactsTab(true);
            setPendingChatToOpen(chat);
          }}
          onOpenDecisionLog={openDecisionLogTab}
          onExportDecisionLog={exportDecisionLog}
          onModuleInspectorStateChange={handleModuleInspectorStateChange}
        />
      );
    }

    if (activeView === 'overview') {
      if (isOnboarding && initiative) {
        return (
          <ProjectStandaloneChatView
            initiativeId={initiativeId}
            hideTiles={true}
            allowInitialProjectOnboarding={true}
            restoreLatestChatOnMount={true}
            useLandingWhenEmpty={true}
            landingLayoutMode="overview"
            landingHeaderContent={(
              <ProjectOnboardingHeader
                initiative={initiative}
                filesUploaded={projectMaterials.length}
              />
            )}
            onEditorWidgetsChange={handleChatEditorWidgetsChange}
            onOpenDocument={openWorkspaceDocument}
            onOpenWorkspaceModule={handleOpenWorkspaceModule}
          />
        );
      }

      return (
        <ProjectStandaloneChatView
          key={researchLandingResetSignal}
          initiativeId={initiativeId}
          hideTiles={true}
          allowInitialProjectOnboarding={false}
          useLandingWhenEmpty={true}
          showLanding={overviewChatOpen}
          landingLayoutMode="overview"
          hideLandingComposer={overviewChatOpen}
          onLandingSend={(content, toolHint) => {
            setPanelOpen('overview', 'chat', true);
            setPendingOverviewAutoSend({
              requestId: `overview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              content,
              toolHint,
            });
          }}
          onEditorWidgetsChange={handleChatEditorWidgetsChange}
          onOpenDocument={openWorkspaceDocument}
          onOpenWorkspaceModule={handleOpenWorkspaceModule}
        />
      );
    }

    if (activeView === 'framework') {
      if (!hasProjectPlan && !isViewer) {
        return (
          <ProjectChatTabsPanel
            initiativeId={initiativeId}
            researchMode={false}
            sessionStorageKey={frameworkChatTabsStorageKey}
            onEditorWidgetsChange={handleChatEditorWidgetsChange}
            onOpenDocument={openWorkspaceDocument}
            onOpenWorkspaceModule={handleOpenWorkspaceModule}
          />
        );
      }

      if (!hasProjectPlan) {
        return (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-text-tertiary">No framework yet</p>
          </div>
        );
      }

      return (
        <div className="relative h-full flex flex-col bg-surface overflow-hidden">
          {renderPlanOverlay}
          {frameworkProgress && frameworkProgress.total > 0 && (
            <div className="flex-shrink-0 px-4 pt-3 pb-2.5 border-b border-divider bg-surface-header">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-text-tertiary">
                  <span className="font-medium text-text-secondary">{frameworkProgress.completed}</span>
                  {' '}of {frameworkProgress.total} complete
                </span>
                <span className="text-[11px] font-medium text-text-secondary tabular-nums">
                  {frameworkProgress.percentage}%
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden bg-surface-subtle w-full">
                <div className="h-full w-full flex">
                  {frameworkProgress.segments.map((segment, idx) => {
                    const widthPct = frameworkProgress.total > 0
                      ? (segment.completed / frameworkProgress.total) * 100
                      : 0;
                    const hasLaterFilledSegment = frameworkProgress.segments
                      .slice(idx + 1)
                      .some((next) => next.completed > 0);
                    return (
                      <div
                        key={segment.id}
                        className="h-full transition-[width] duration-300 ease-out flex-shrink-0"
                        style={{
                          width: `${widthPct}%`,
                          backgroundColor: widthPct > 0 ? segment.color : 'transparent',
                          borderRadius: !hasLaterFilledSegment ? '0 9999px 9999px 0' : undefined,
                          borderRight: widthPct > 0 && hasLaterFilledSegment ? '1px solid #F7F5F2' : undefined,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-hidden">
            {frameworkActiveModule ? (
              <div className="h-full flex flex-col">
                <div className="flex-shrink-0 px-4 py-3 border-b border-divider bg-surface">
                  <button
                    type="button"
                    onClick={() => {
                      setFrameworkActiveModule(null);
                      frameworkDeepDiveRef.current = null;
                      setFrameworkDeepDiveRequest(null);
                    }}
                    className="btn-secondary !px-3 !py-1.5 !text-xs"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back to framework
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <ModuleWorkspace
                    instanceId={frameworkActiveModule.instanceId}
                    moduleId={frameworkActiveModule.moduleId}
                    initiativeId={initiativeId}
                    onAddToChat={(text) => {
                      setPanelOpen('framework', 'chat', true);
                      chatSendRef.current?.(text, frameworkActiveModule.moduleId);
                    }}
                    onOpenDecisionLog={openDecisionLogTab}
                    onExportDecisionLog={exportDecisionLog}
                    onInspectorStateChange={handleFrameworkInspectorStateChange}
                  />
                </div>
              </div>
            ) : (
              <FrameworkPlanView
                plannedModuleIds={frameworkPlannedModuleIds}
                moduleInstances={frameworkModuleInstances}
                loading={frameworkModulesLoading}
                onAddModuleToFrameworkPlan={handleAddModuleToFrameworkPlan}
                onRemoveModuleFromFrameworkPlan={handleRemoveModuleFromFrameworkPlan}
                onCreateModuleInstanceInModulesView={handleCreateModuleInstanceInModulesView}
                onOpenExistingModuleInstanceInModulesView={handleOpenExistingModuleInstanceInModulesView}
                readOnly={Boolean(isViewer)}
                onOpenModule={(module) => handleOpenFrameworkModule({
                  instanceId: module.id,
                  moduleId: module.module_id,
                  title: module.title,
                })}
              />
            )}
          </div>
        </div>
      );
    }

    return <div className="h-full" />;
  })();

  const sideChatContent = overviewChatOpen ? (
    <div className="h-full flex overflow-hidden">
      <div className="flex-1 min-w-0">
        <ProjectChatTabsPanel
          initiativeId={initiativeId}
          researchMode={false}
          sessionStorageKey={sideChatTabsStorageKey}
          pendingChatToOpen={pendingChatToOpen}
          pendingAutoSend={pendingOverviewAutoSend}
          onPendingSessionHandled={() => setPendingChatToOpen(null)}
          onPendingAutoSendHandled={() => setPendingOverviewAutoSend(null)}
          onEditorWidgetsChange={handleChatEditorWidgetsChange}
          onOpenDocument={openWorkspaceDocument}
          onOpenWorkspaceModule={handleOpenWorkspaceModule}
          onSendRef={chatSendRef}
        />
      </div>
    </div>
  ) : modulesChatOpen ? (
    <div className="h-full flex overflow-hidden">
      <div className="flex-1 min-w-0">
        <ProjectChatTabsPanel
          initiativeId={initiativeId}
          researchMode={false}
          sessionStorageKey={sideChatTabsStorageKey}
          pendingChatToOpen={pendingChatToOpen}
          activeModuleContext={activeModuleContext}
          onPendingSessionHandled={() => setPendingChatToOpen(null)}
          onEditorWidgetsChange={handleChatEditorWidgetsChange}
          onOpenDocument={openWorkspaceDocument}
          onOpenWorkspaceModule={handleOpenWorkspaceModule}
          onSendRef={chatSendRef}
          pendingDeepDive={modulesDeepDiveRequest ? {
            requestId: modulesDeepDiveRequest.requestId,
            state: modulesDeepDiveRequest.state,
          } : null}
          onPendingDeepDiveHandled={() => setModulesDeepDiveRequest(null)}
        />
      </div>
    </div>
  ) : frameworkChatOpen ? (
    <div className="h-full flex overflow-hidden">
      <div className="flex-1 min-w-0">
        <ProjectChatTabsPanel
          initiativeId={initiativeId}
          researchMode={false}
          sessionStorageKey={sideChatTabsStorageKey}
          pendingChatToOpen={pendingChatToOpen}
          activeModuleContext={frameworkModuleContext}
          onPendingSessionHandled={() => setPendingChatToOpen(null)}
          onEditorWidgetsChange={handleChatEditorWidgetsChange}
          onOpenDocument={openWorkspaceDocument}
          onOpenWorkspaceModule={handleOpenWorkspaceModule}
          onSendRef={chatSendRef}
          pendingDeepDive={frameworkDeepDiveRequest ? {
            requestId: frameworkDeepDiveRequest.requestId,
            state: frameworkDeepDiveRequest.state,
            onOpenDocument: (source) => openWorkspaceDocument({
              evidence_doc_id: source.evidenceDocId,
              chunk_id: source.chunkId ?? null,
              source_title: source.title,
            }),
          } : null}
          onPendingDeepDiveHandled={() => setFrameworkDeepDiveRequest(null)}
        />
      </div>
    </div>
  ) : null;

  return (
    <>
      <ShellPageHeader chromeReady={chromeReady}>
        {initiative && (
          <ProjectHeader
            initiative={initiative}
            onTitleUpdate={isViewer ? undefined : handleTitleUpdate}
            readOnly={Boolean(isViewer)}
            leftToggle={workspaceHeaderToggle}
            rightToggle={chatHeaderToggle}
          />
        )}
      </ShellPageHeader>

      <div className="flex-1 p-2 pt-0 pl-1 min-h-0">
        <div className="h-full bg-surface rounded-lg shadow-workspace overflow-hidden relative">
          {showOverlay && (
            <div
              className={`absolute inset-0 z-50 flex flex-col items-center justify-center gap-1.5 bg-surface/95 backdrop-blur-xl transition-opacity duration-300 ${pageReady ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
            >
              <PageLoader label="" />
            </div>
          )}

          {loading && !initiative ? (
            <div className="h-full flex items-center justify-center">
              <PageLoader label="" />
            </div>
          ) : !initiative ? (
            error ? (
              <div className="h-full flex flex-col items-center justify-center gap-4">
                <div className="card p-8 text-center max-w-md">
                  <p className="text-indicator-orange mb-4">{error}</p>
                  <Link href="/" className="btn-secondary inline-flex">
                    <ArrowLeft className="w-4 h-4" />
                    Back to projects
                  </Link>
                </div>
              </div>
            ) : (
              <div className="h-full" />
            )
          ) : (
            <main ref={workspaceContainerRef} className="h-full min-w-0 flex overflow-hidden relative">
              {showPrimaryPanel && (
                <div className="flex-1 min-w-0 overflow-hidden">{primaryWorkspaceContent}</div>
              )}

              {showPrimaryPanel && sideChatOpen && (
                <>
                  <div
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setIsResizingChat(true);
                    }}
                    className={`w-2 flex-shrink-0 cursor-col-resize relative group ${isResizingChat ? 'bg-accent/10' : ''}`}
                  >
                    <div className={`absolute left-1/2 top-0 h-full -translate-x-1/2 w-px transition-colors ${isResizingChat ? 'bg-accent/60' : 'bg-divider group-hover:bg-accent/40'}`} />
                  </div>

                  <div className="flex-shrink-0 overflow-hidden" style={{ width: `${chatPanelWidthPercent}%` }}>
                    {sideChatContent}
                  </div>
                </>
              )}

              {!showPrimaryPanel && sideChatOpen && (
                <div className="flex-1 min-w-0 overflow-hidden">{sideChatContent}</div>
              )}
            </main>
          )}
        </div>
      </div>
    </>
  );
}

export default function InitiativePage() {
  return (
    <ProtectedRoute>
      <InitiativePageContent />
    </ProtectedRoute>
  );
}
