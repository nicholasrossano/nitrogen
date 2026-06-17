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
import { ProjectChatSurface } from '@/components/core-chat/ProjectChatSurface';
import { FrameworkPlanView } from '@/components/framework/FrameworkPlanView';
import { AssumptionsWorkspaceTab } from '@/components/assumptions/AssumptionsWorkspaceTab';
import { AssessmentsProgressBar } from '@/components/ui/ReadinessProgressBar';
import { ALL_MODULES, MODULE_CATEGORIES } from '@/components/chat/AssessmentPicker';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ProjectChatTabsPanel } from '@/components/core-chat/ProjectChatTabsPanel';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import type { PlanWorkspaceInspectorState } from '@/components/plan-workspace';
import { ShellPageHeader } from '@/components/ui';
import { useShellNav } from '@/components/ui/ShellContext';
import type { NavItem } from '@/components/ui/SideDrawer';
import { PageLoader } from '@/components/ui/PageLoader';
import { api, type Assumption, type AssessmentInstance } from '@/lib/api';
import { PROJECT_VARIABLES } from '@/lib/projectVariablesCopy';
import { DIAGRAM_ACCENT_COLOR } from '@/lib/diagramAccent';
import { importFromDriveViaPicker } from '@/lib/driveImport';
import { filterVisibleAssessments } from '@/lib/featureFlags';
import { useFeatureFlagContext } from '@/hooks/useFeatureFlag';
import { useGoogleDriveStore } from '@/stores/googleDriveStore';
import { useInitiativeStore } from '@/stores/initiativeStore';

const ProjectFilesView = dynamic(() => import('@/components/files').then((m) => ({ default: m.ProjectFilesView })), { ssr: false });
const MIN_CHAT_PANEL_PERCENT = 20;
const MAX_CHAT_PANEL_PERCENT = 60;
const DEFAULT_CHAT_PANEL_PERCENT = 30;

type InitiativeView = 'overview' | 'assessments' | 'framework' | 'assumptions' | 'files';

function viewFromSearchParam(viewParam: string | null): InitiativeView {
  if (viewParam === 'overview' || viewParam === 'research' || viewParam === 'explore') return 'overview';
  if (viewParam === 'framework' || viewParam === 'plan') return 'framework';
  if (viewParam === 'workspace' || viewParam === 'assessments') return 'assessments';
  if (viewParam === 'assumptions') return 'assumptions';
  if (viewParam === 'files') return 'files';
  return 'overview';
}

function makeDocumentTabId(citation: ResearchPanelCitation): string {
  return `document-${citation.evidence_doc_id}`;
}

interface PendingDeepDiveRequest {
  requestId: string;
  state: PlanWorkspaceInspectorState;
}

interface PendingAssumptionsRequest {
  requestId: string;
  focusAssumptionId?: string | null;
  createNew?: boolean;
  title?: string | null;
  forceNewTab?: boolean;
  autoSend?: {
    requestId: string;
    content: string;
    toolHint?: string;
    fieldContext?: import('@/lib/api').FieldContext | null;
    modelInputsContext?: string | null;
    assumptionId?: string | null;
  } | null;
}

interface StoredInitiativeWorkspaceUiState {
  panelVisibility: {
    overview: { workspace: boolean; chat: boolean };
    assessments: { workspace: boolean; chat: boolean };
    framework: { workspace: boolean; chat: boolean };
    assumptions: { workspace: boolean; chat: boolean };
  };
  chatPanelWidthPercent: number;
  workspaceTabs: WorkspacePanelTab[];
  activeWorkspaceTabId: string | null;
}

const DEFAULT_PANEL_VISIBILITY: StoredInitiativeWorkspaceUiState['panelVisibility'] = {
  overview: { workspace: true, chat: false },
  assessments: { workspace: true, chat: false },
  framework: { workspace: true, chat: false },
  assumptions: { workspace: true, chat: false },
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
            typeof (tab as { kind?: unknown }).kind === 'string' &&
            (tab as { kind?: unknown }).kind !== 'artifacts',
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
    const rawPanelVisibility = parsed.panelVisibility as Partial<StoredInitiativeWorkspaceUiState['panelVisibility']>;
    const panelVisibility: StoredInitiativeWorkspaceUiState['panelVisibility'] = {
      overview: rawPanelVisibility?.overview ?? DEFAULT_PANEL_VISIBILITY.overview,
      assessments: rawPanelVisibility?.assessments ?? DEFAULT_PANEL_VISIBILITY.assessments,
      framework: rawPanelVisibility?.framework ?? DEFAULT_PANEL_VISIBILITY.framework,
      assumptions: rawPanelVisibility?.assumptions ?? DEFAULT_PANEL_VISIBILITY.assumptions,
    };

    return {
      panelVisibility,
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
  const [assessmentsDeepDiveRequest, setAssessmentsDeepDiveRequest] = useState<PendingDeepDiveRequest | null>(null);
  const [pendingAssumptionsRequest, setPendingAssumptionsRequest] = useState<PendingAssumptionsRequest | null>(null);
  const [chatEditorWidgets, setChatEditorWidgets] = useState<EditorWidget[]>([]);
  const [workspaceLaunchMode, setWorkspaceLaunchMode] = useState<WorkspaceLaunchMode>('idle');
  const [pendingChatToOpen, setPendingChatToOpen] = useState<{ chatId: string; title?: string | null } | null>(null);
  const [pendingOverviewAutoSend, setPendingOverviewAutoSend] = useState<{
    requestId: string;
    content: string;
    toolHint?: string;
  } | null>(null);
  const [pendingAssessmentActivityLogRequest, setPendingAssessmentActivityLogRequest] = useState<{
    requestId: string;
    instanceId: string;
    assessmentId: string;
    title: string;
  } | null>(null);
  const [researchLandingResetSignal, setResearchLandingResetSignal] = useState(0);
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspacePanelTab[]>(
    initialWorkspaceUiRef.current?.workspaceTabs ?? [],
  );
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState<string | null>(
    initialWorkspaceUiRef.current?.activeWorkspaceTabId ?? null,
  );
  const [frameworkAssessmentInstances, setFrameworkAssessmentInstances] = useState<AssessmentInstance[]>([]);
  const [frameworkPlannedAssessmentIds, setFrameworkPlannedAssessmentIds] = useState<string[]>([]);
  const [frameworkAssessmentsLoading, setFrameworkAssessmentsLoading] = useState(false);
  const onboardingSeenRef = useRef(false);
  const assessmentsDeepDiveRef = useRef<{ key: string; requestId: string } | null>(null);
  const frameworkAssessmentsCacheRef = useRef<Map<string, AssessmentInstance[]>>(new Map());
  const frameworkAssessmentsRequestRef = useRef<Map<string, Promise<AssessmentInstance[]>>>(new Map());

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
  const featureFlagContext = useFeatureFlagContext();

  const visibleAssessmentMetaById = useMemo(
    () => new Map(
      filterVisibleAssessments(ALL_MODULES, featureFlagContext)
        .map((assessment) => [assessment.id, assessment]),
    ),
    [featureFlagContext],
  );
  const visibleFrameworkPlannedAssessmentIds = useMemo(
    () => frameworkPlannedAssessmentIds.filter((assessmentId) => visibleAssessmentMetaById.has(assessmentId)),
    [frameworkPlannedAssessmentIds, visibleAssessmentMetaById],
  );

  const hasProjectPlan = Boolean(projectPlan);
  const hasFrameworkSelection = Boolean(
    hasProjectPlan ||
    visibleFrameworkPlannedAssessmentIds.length > 0,
  );
  const isOnboarding = Boolean(
    initiative &&
    !isViewer &&
    !hasFrameworkSelection,
  );
  const frameworkProgress = useMemo(
    () => {
      const categoryForAssessmentId = new Map<string, string>();
      MODULE_CATEGORIES.forEach((category) => {
        category.assessmentIds.forEach((assessmentId) => categoryForAssessmentId.set(assessmentId, category.id));
      });

      const approvedAssessmentIds = new Set(
        frameworkAssessmentInstances
          .filter((instance) => instance.is_plan_complete === true)
          .map((instance) => instance.assessment_id),
      );

      const segments = MODULE_CATEGORIES.map((category) => {
        const plannedInCategory = visibleFrameworkPlannedAssessmentIds.filter(
          (assessmentId) => categoryForAssessmentId.get(assessmentId) === category.id,
        );
        const approvedCount = plannedInCategory.filter((assessmentId) => approvedAssessmentIds.has(assessmentId)).length;
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
    [frameworkAssessmentInstances, visibleFrameworkPlannedAssessmentIds],
  );
  const frameworkPlanAssessmentOptions = useMemo(
    () => visibleFrameworkPlannedAssessmentIds
      .map((id) => visibleAssessmentMetaById.get(id))
      .filter((m): m is (typeof ALL_MODULES)[number] => Boolean(m)),
    [visibleFrameworkPlannedAssessmentIds, visibleAssessmentMetaById],
  );
  const activeWorkspaceTab = useMemo(
    () => workspaceTabs.find((tab) => tab.id === activeWorkspaceTabId) ?? null,
    [workspaceTabs, activeWorkspaceTabId],
  );
  const activeAssessmentContext = useMemo(() => {
    if (activeWorkspaceTab?.kind === 'assessment') {
      return {
        instanceId: activeWorkspaceTab.instanceId,
        assessmentId: activeWorkspaceTab.assessmentId,
        title: activeWorkspaceTab.title,
      };
    }
    if (activeWorkspaceTab?.kind === 'decision-log' && activeWorkspaceTab.assessmentId) {
      return {
        instanceId: activeWorkspaceTab.assessmentInstanceId,
        assessmentId: activeWorkspaceTab.assessmentId,
        title: activeWorkspaceTab.title,
      };
    }
    return null;
  }, [activeWorkspaceTab]);
  const visibleWorkspaceTabs = useMemo(
    () => (activeView === 'assessments' ? workspaceTabs : []),
    [activeView, workspaceTabs],
  );
  const visibleWorkspaceActiveTabId = useMemo(
    () => (visibleWorkspaceTabs.some((tab) => tab.id === activeWorkspaceTabId) ? activeWorkspaceTabId : null),
    [visibleWorkspaceTabs, activeWorkspaceTabId],
  );
  const showTabbedWorkspace = activeView === 'assessments';
  const overviewWorkspaceOpen = activeView === 'overview' && panelVisibility.overview.workspace;
  const overviewChatOpen = activeView === 'overview' && panelVisibility.overview.chat;
  const assessmentsWorkspaceOpen = activeView === 'assessments' && panelVisibility.assessments.workspace;
  const assessmentsChatOpen = activeView === 'assessments' && panelVisibility.assessments.chat;
  const frameworkWorkspaceOpen =
    activeView === 'framework' && (!hasFrameworkSelection || panelVisibility.framework.workspace);
  const frameworkChatOpen = activeView === 'framework' && hasFrameworkSelection && panelVisibility.framework.chat;
  const assumptionsWorkspaceOpen = activeView === 'assumptions' && panelVisibility.assumptions.workspace;
  const assumptionsChatOpen = activeView === 'assumptions' && panelVisibility.assumptions.chat;
  const workspaceOpen =
    overviewWorkspaceOpen || assessmentsWorkspaceOpen || frameworkWorkspaceOpen || assumptionsWorkspaceOpen;
  const chatOpen = overviewChatOpen || assessmentsChatOpen || frameworkChatOpen || assumptionsChatOpen;
  const sideChatOpen = overviewChatOpen || assessmentsChatOpen || frameworkChatOpen || assumptionsChatOpen;
  const sideChatMode: 'overview' | 'assessments' | 'framework' | 'assumptions' | null =
    activeView === 'overview'
      ? 'overview'
      : activeView === 'assessments'
        ? 'assessments'
        : activeView === 'framework' && hasFrameworkSelection
          ? 'framework'
          : activeView === 'assumptions'
            ? 'assumptions'
            : null;
  const showPrimaryPanel = activeView === 'overview' || activeView === 'files' || workspaceOpen;
  const hasSideChatShell = Boolean(sideChatMode);
  const sideChatWidthPercent = !hasSideChatShell
    ? 0
    : !sideChatOpen
      ? 0
      : !showPrimaryPanel
        ? 100
        : chatPanelWidthPercent;
  const primaryPanelWidthPercent = hasSideChatShell
    ? (showPrimaryPanel ? Math.max(0, 100 - sideChatWidthPercent) : 0)
    : (showPrimaryPanel ? 100 : 0);
  const showChatResizeHandle = hasSideChatShell && showPrimaryPanel && sideChatOpen;
  const sideChatTabsStorageKey = `nitrogen_side_chat_tabs_${initiativeId}`;
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

  const setPanelOpen = useCallback(
    (view: 'overview' | 'assessments' | 'framework' | 'assumptions', panel: 'workspace' | 'chat', open: boolean) => {
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
      if (activeView !== 'assessments') return;

      const chatAlreadyOpen = panelVisibility.assessments.chat;
      if (!chatAlreadyOpen) {
        setPanelOpen('assessments', 'chat', true);
      }
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('nitrogen:draft', {
            detail: { ...detail, _workspaceForwarded: true },
          }),
        );
      }, chatAlreadyOpen ? 0 : 75);
    };

    window.addEventListener('nitrogen:draft', handler);
    return () => window.removeEventListener('nitrogen:draft', handler);
  }, [activeView, panelVisibility.assessments.chat, setPanelOpen]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        assumptionId?: string | null;
        title?: string | null;
        text?: string | null;
        toolHint?: string | null;
        fieldContext?: import('@/lib/api').FieldContext | null;
        modelInputsContext?: string | null;
      } | null;
      if (!detail?.assumptionId) return;
      const requestId = `assumption-investigate-${detail.assumptionId}-${Date.now()}`;

      const stayOnAssessments = activeView === 'assessments';
      if (stayOnAssessments) {
        setPanelOpen('assessments', 'chat', true);
      } else {
        setWorkspaceLaunchMode('idle');
        setPanelOpen('assumptions', 'workspace', true);
        setPanelOpen('assumptions', 'chat', true);
        setActiveView('assumptions');
        router.replace(`/initiatives/${initiativeId}?view=assumptions`);
      }

      setPendingAssumptionsRequest({
        requestId,
        focusAssumptionId: detail.assumptionId,
        createNew: false,
        title: detail.title ?? `${PROJECT_VARIABLES.titleSingular} investigation`,
        forceNewTab: true,
        autoSend: detail.text
          ? {
              requestId: `autosend-${requestId}`,
              content: detail.text,
              toolHint: detail.toolHint ?? undefined,
              fieldContext: detail.fieldContext ?? null,
              modelInputsContext: detail.modelInputsContext ?? null,
              assumptionId: detail.assumptionId,
            }
          : null,
      });
    };

    window.addEventListener('nitrogen:open-assumption-chat', handler);
    return () => window.removeEventListener('nitrogen:open-assumption-chat', handler);
  }, [activeView, initiativeId, router, setPanelOpen]);

  const handleFilesViewDriveImport = useCallback(async () => {
    await importFromDriveViaPicker({
      initiativeId,
      driveConnected,
      connectDrive,
      getDriveAccessToken,
      importFromDrive,
    });
  }, [driveConnected, connectDrive, getDriveAccessToken, importFromDrive, initiativeId]);

  const loadFrameworkAssessmentInstances = useCallback(async (
    targetInitiativeId: string,
    options?: { force?: boolean },
  ) => {
    const force = options?.force === true;
    const cached = frameworkAssessmentsCacheRef.current.get(targetInitiativeId);
    if (cached && !force) {
      setFrameworkAssessmentInstances(cached);
      return;
    }

    let request = frameworkAssessmentsRequestRef.current.get(targetInitiativeId);
    if (!request || force) {
      request = api.listAssessmentInstances(targetInitiativeId);
      frameworkAssessmentsRequestRef.current.set(targetInitiativeId, request);
    }

    setFrameworkAssessmentsLoading(true);
    try {
      const instances = await request;
      frameworkAssessmentsCacheRef.current.set(targetInitiativeId, instances);
      setFrameworkAssessmentInstances(instances);
    } catch {
      setFrameworkAssessmentInstances([]);
    } finally {
      if (frameworkAssessmentsRequestRef.current.get(targetInitiativeId) === request) {
        frameworkAssessmentsRequestRef.current.delete(targetInitiativeId);
      }
      setFrameworkAssessmentsLoading(false);
    }
  }, []);

  useShellNav(useCallback((item: NavItem): boolean => {
    if (item === 'portfolio') {
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
      setPanelOpen('assessments', 'workspace', true);
      // Drawer click should always land on the assessment hub.
      setWorkspaceLaunchMode('open');
      setActiveWorkspaceTabId(null);
      setActiveView('assessments');
      router.replace(`/initiatives/${initiativeId}?view=assessments`);
      return true;
    }
    if (item === 'assumptions') {
      setWorkspaceLaunchMode('idle');
      setPanelOpen('assumptions', 'workspace', true);
      setActiveView('assumptions');
      router.replace(`/initiatives/${initiativeId}?view=assumptions`);
      return true;
    }
    if (item === 'files') {
      setActiveView('files');
      router.replace(`/initiatives/${initiativeId}?view=files`);
      return true;
    }
    if (item === 'plan') {
      setActiveView('framework');
      router.replace(`/initiatives/${initiativeId}?view=framework`);
      return true;
    }
    return false;
  }, [router, initiativeId, activeView, setPanelOpen]));

  useEffect(() => {
    if (isViewer && (activeView === 'overview' || activeView === 'assessments' || activeView === 'assumptions')) {
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
    if (!hasFrameworkSelection || !onboardingSeenRef.current || isViewer) return;
    onboardingSeenRef.current = false;
    setActiveView('framework');
    router.replace(`/initiatives/${initiativeId}?view=framework`);
  }, [initiative, hasFrameworkSelection, isOnboarding, isViewer, initiativeId, router]);

  useEffect(() => {
    if (!initiativeId) return;
    const storedWorkspaceUi = readStoredWorkspaceUiState(workspaceUiStorageKey);

    setPanelVisibility(storedWorkspaceUi?.panelVisibility ?? DEFAULT_PANEL_VISIBILITY);
    setChatPanelWidthPercent(storedWorkspaceUi?.chatPanelWidthPercent ?? DEFAULT_CHAT_PANEL_PERCENT);
    setWorkspaceTabs(storedWorkspaceUi?.workspaceTabs ?? []);
    setActiveWorkspaceTabId(storedWorkspaceUi?.activeWorkspaceTabId ?? null);
    setFrameworkAssessmentInstances([]);
    setFrameworkPlannedAssessmentIds([]);
    setFrameworkAssessmentsLoading(false);
    setAssessmentsDeepDiveRequest(null);
    assessmentsDeepDiveRef.current = null;
    setChatEditorWidgets([]);
    setWorkspaceLaunchMode('idle');
    setPendingChatToOpen(null);
    setPendingOverviewAutoSend(null);
      setPendingAssessmentActivityLogRequest(null);
    setPageReady(false);
    setChromeReady(false);
    setShowOverlay(true);
    onboardingSeenRef.current = false;

    reset();
    const initiativeLoad = loadInitiative(initiativeId);
    initiativeLoad.finally(() => setChromeReady(true));
    initiativeLoad.finally(() => setPageReady(true));

    loadEvidence(initiativeId);
    loadMaterials(initiativeId);
    loadFrameworkAssessmentInstances(initiativeId);
    loadDriveLinkedFiles(initiativeId).then(() => {
      syncDriveFiles(initiativeId).catch(() => {});
    });
  }, [initiativeId, workspaceUiStorageKey, reset, loadInitiative, loadEvidence, loadMaterials, loadDriveLinkedFiles, syncDriveFiles, loadFrameworkAssessmentInstances]);

  useEffect(() => {
    if (activeView !== 'framework') return;
    if (!initiativeId) return;
    loadFrameworkAssessmentInstances(initiativeId);
  }, [activeView, initiativeId, loadFrameworkAssessmentInstances]);

  useEffect(() => {
    if (!initiative) return;
    if (initiative.selected_tools !== null && initiative.selected_tools !== undefined) {
      setFrameworkPlannedAssessmentIds(Array.from(new Set(initiative.selected_tools)));
      return;
    }
    setFrameworkPlannedAssessmentIds([]);
  }, [initiativeId, initiative?.selected_tools]);

  useEffect(() => {
    if (!initiative) return;
    if (initiative.selected_tools !== null && initiative.selected_tools !== undefined) return;
    if (frameworkPlannedAssessmentIds.length > 0) return;
    if (frameworkAssessmentInstances.length === 0) return;
    const inferred = Array.from(new Set(frameworkAssessmentInstances.map((instance) => instance.assessment_id)));
    setFrameworkPlannedAssessmentIds(inferred);
  }, [initiative, frameworkAssessmentInstances, frameworkPlannedAssessmentIds.length]);

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
    // Safety cleanup: remove any persisted Chat Outputs tab from prior sessions.
    if (!workspaceTabs.some((tab) => tab.kind === 'artifacts')) return;
    const nextTabs = workspaceTabs.filter((tab) => tab.kind !== 'artifacts');
    setWorkspaceTabs(nextTabs);
    if (activeWorkspaceTabId && !nextTabs.some((tab) => tab.id === activeWorkspaceTabId)) {
      setActiveWorkspaceTabId(nextTabs[0]?.id ?? null);
    }
  }, [workspaceTabs, activeWorkspaceTabId]);

  useEffect(() => {
    if (activeView !== 'assessments') return;
    if (activeWorkspaceTabId !== null) return;
    if (workspaceTabs.length === 0) return;
    setActiveWorkspaceTabId(workspaceTabs[0].id);
  }, [activeView, activeWorkspaceTabId, workspaceTabs]);

  const openWorkspaceTab = useCallback((tab: WorkspacePanelTab) => {
    setWorkspaceTabs((prev) => {
      const existingIndex = prev.findIndex((existingTab) => existingTab.id === tab.id);
      if (existingIndex === -1) {
        return [...prev, tab];
      }
      const next = [...prev];
      next[existingIndex] = tab;
      return next;
    });
    setActiveWorkspaceTabId(tab.id);
  }, []);

  const handleOpenWorkspaceAssessment = useCallback(
    (assessment: {
      instanceId: string;
      assessmentId: string;
      title?: string | null;
      chatId?: string | null;
      chatTitle?: string | null;
      openChatPanel?: boolean;
    }) => {
      const openChatPanel = assessment.openChatPanel ?? true;
      setWorkspaceLaunchMode('idle');
      setPanelOpen('assessments', 'workspace', true);
      setPanelOpen('assessments', 'chat', openChatPanel);
      loadFrameworkAssessmentInstances(initiativeId);
      if (openChatPanel && assessment.chatId) {
        setPendingChatToOpen({
          chatId: assessment.chatId,
          title: assessment.chatTitle || assessment.title || null,
        });
      }
      setActiveView('assessments');
      router.replace(`/initiatives/${initiativeId}?view=assessments`);
      openWorkspaceTab({
        id: `assessment-${assessment.instanceId}`,
        kind: 'assessment',
        title: assessment.title || assessment.assessmentId.replace(/_/g, ' '),
        instanceId: assessment.instanceId,
        assessmentId: assessment.assessmentId,
      });
    },
    [initiativeId, openWorkspaceTab, router, setPanelOpen, loadFrameworkAssessmentInstances],
  );

  const openWorkspaceDocument = useCallback((citation: ResearchPanelCitation) => {
    setWorkspaceLaunchMode('idle');
    setPanelOpen('assessments', 'workspace', true);
    setPanelOpen('assessments', 'chat', true);
    setActiveView('assessments');
    router.replace(`/initiatives/${initiativeId}?view=assessments`);
    openWorkspaceTab({
      id: makeDocumentTabId(citation),
      kind: 'document',
      title: citation.source_title || 'Document',
      citation,
    });
  }, [initiativeId, openWorkspaceTab, router, setPanelOpen]);

  const openAssumptionsView = useCallback(() => {
    setWorkspaceLaunchMode('idle');
    setPanelOpen('assumptions', 'workspace', true);
    setPanelOpen('assumptions', 'chat', false);
    setActiveView('assumptions');
    router.replace(`/initiatives/${initiativeId}?view=assumptions`);
  }, [initiativeId, router, setPanelOpen]);

  const handleOpenAssumptionInChat = useCallback((assumption: Assumption) => {
    setWorkspaceLaunchMode('idle');
    setPanelOpen('assumptions', 'workspace', true);
    setPanelOpen('assumptions', 'chat', true);
    setActiveView('assumptions');
    router.replace(`/initiatives/${initiativeId}?view=assumptions`);
    setPendingAssumptionsRequest({
      requestId: `assumption-${assumption.id}-${Date.now()}`,
      focusAssumptionId: assumption.id,
      createNew: false,
      title: assumption.label,
      forceNewTab: false,
    });
  }, [initiativeId, router, setPanelOpen]);

  const handleAddAssumptionInChat = useCallback(() => {
    setWorkspaceLaunchMode('idle');
    setPanelOpen('assumptions', 'workspace', true);
    setPanelOpen('assumptions', 'chat', true);
    setActiveView('assumptions');
    router.replace(`/initiatives/${initiativeId}?view=assumptions`);
    setPendingAssumptionsRequest({
      requestId: `assumption-new-${Date.now()}`,
      focusAssumptionId: null,
      createNew: true,
      title: `New ${PROJECT_VARIABLES.lowerSingular}`,
      forceNewTab: true,
    });
  }, [initiativeId, router, setPanelOpen]);

  const openDecisionLogTab = useCallback(
    (context: { instanceId: string; assessmentId: string; title: string }) => {
      setActiveView('assessments');
      router.replace(`/initiatives/${initiativeId}?view=assessments`);
      openWorkspaceTab({
        id: `decision-log-${context.instanceId}`,
        kind: 'decision-log',
        title: `[Log] ${context.title}`,
        assessmentInstanceId: context.instanceId,
        assessmentId: context.assessmentId,
      });
    },
    [initiativeId, openWorkspaceTab, router],
  );

  const openAssessmentActivityLogInChat = useCallback(
    (context: { instanceId: string; assessmentId: string; title: string }) => {
      setActiveView('assessments');
      setPanelOpen('assessments', 'workspace', true);
      setPanelOpen('assessments', 'chat', true);
      router.replace(`/initiatives/${initiativeId}?view=assessments`);
      setPendingAssessmentActivityLogRequest({
        requestId: `assessment-activity-${context.instanceId}-${Date.now()}`,
        instanceId: context.instanceId,
        assessmentId: context.assessmentId,
        title: context.title,
      });
    },
    [initiativeId, router, setPanelOpen],
  );

  const exportDecisionLog = useCallback(
    async (context: { instanceId: string; assessmentId: string; title: string }) => {
      const { blob, filename } = await api.exportAssessmentDecisionLogXlsx(context.instanceId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    [],
  );

  const handleCreateAssessmentInstanceInAssessmentsView = useCallback(async (
    assessmentId: string,
    assessmentName: string,
  ) => {
    const instance = await api.createAssessmentInstance(initiativeId, assessmentId);
    setFrameworkAssessmentInstances((prev) => {
      const next = [...prev, instance];
      frameworkAssessmentsCacheRef.current.set(initiativeId, next);
      return next;
    });
    handleOpenWorkspaceAssessment({
      instanceId: instance.id,
      assessmentId: instance.assessment_id,
      title: instance.display_name || assessmentName,
      openChatPanel: false,
    });
  }, [initiativeId, handleOpenWorkspaceAssessment]);

  const handleOpenExistingAssessmentInstanceInAssessmentsView = useCallback(async (
    instance: AssessmentInstance,
  ) => {
    handleOpenWorkspaceAssessment({
      instanceId: instance.id,
      assessmentId: instance.assessment_id,
      title: instance.display_name || instance.title || instance.assessment_id.replace(/_/g, ' '),
      openChatPanel: false,
    });
  }, [handleOpenWorkspaceAssessment]);

  const handleAddAssessmentToFrameworkPlan = useCallback(async (assessmentId: string) => {
    const next = Array.from(new Set([...frameworkPlannedAssessmentIds, assessmentId]));
    const response = await api.selectTools(initiativeId, next);
    setFrameworkPlannedAssessmentIds(response.selected_tools);
  }, [frameworkPlannedAssessmentIds, initiativeId]);

  const handleRemoveAssessmentFromFrameworkPlan = useCallback(async (assessmentId: string) => {
    const next = frameworkPlannedAssessmentIds.filter((id) => id !== assessmentId);
    const response = await api.selectTools(initiativeId, next);
    setFrameworkPlannedAssessmentIds(response.selected_tools);
  }, [frameworkPlannedAssessmentIds, initiativeId]);

  const closeWorkspaceTab = useCallback((tabId: string) => {
    setWorkspaceTabs((prev) => {
      const nextTabs = prev.filter((tab) => tab.id !== tabId);
      setActiveWorkspaceTabId((current) => {
        if (current !== tabId) return current;
        if (activeView === 'assessments') {
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
    const nextPercent = ((event.clientX - rect.left) / rect.width) * 100;
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

  const handleAssessmentInspectorStateChange = useCallback((state: PlanWorkspaceInspectorState | null) => {
    if (!state) {
      assessmentsDeepDiveRef.current = null;
      setAssessmentsDeepDiveRequest(null);
      return;
    }

    const key = inspectorRequestKey(state);
    const existing = assessmentsDeepDiveRef.current;
    const requestId = existing?.key === key
      ? existing.requestId
      : `assessment-deep-dive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    assessmentsDeepDiveRef.current = { key, requestId };
    setAssessmentsDeepDiveRequest({ requestId, state });
    if (existing?.key !== key) {
      setPanelOpen('assessments', 'chat', true);
    }
  }, [setPanelOpen]);

  const handleTitleUpdate = useCallback((title: string) => {
    updateTitle(initiativeId, title);
  }, [initiativeId, updateTitle]);

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
          showAssessmentActions={activeView === 'assessments'}
          frameworkPlanAssessments={activeView === 'assessments' ? frameworkPlanAssessmentOptions : undefined}
          onNewAssessment={activeView === 'assessments' ? handleCreateAssessmentInstanceInAssessmentsView : undefined}
          onSendToChat={(content, toolHint) => {
            setPanelOpen('assessments', 'chat', true);
            chatSendRef.current?.(content, toolHint);
          }}
          onOpenAssessmentActivityLogInChat={openAssessmentActivityLogInChat}
          onOpenChatSession={(chat) => {
            setPanelOpen('assessments', 'chat', true);
            setPendingChatToOpen(chat);
          }}
          onOpenDecisionLog={openDecisionLogTab}
          onExportDecisionLog={exportDecisionLog}
          onAssessmentInspectorStateChange={handleAssessmentInspectorStateChange}
          onAssessmentApprovalChange={() => loadFrameworkAssessmentInstances(initiativeId, { force: true })}
          onOpenAssumptionInChat={handleOpenAssumptionInChat}
          onAddAssumptionInChat={handleAddAssumptionInChat}
          assessmentInstances={frameworkAssessmentInstances}
          onOpenAssessmentInstance={handleOpenExistingAssessmentInstanceInAssessmentsView}
        />
      );
    }

    if (activeView === 'overview') {
      if (isOnboarding && initiative) {
        return (
          <ProjectChatSurface
            initiativeId={initiativeId}
            hideTiles={true}
            allowInitialProjectOnboarding={true}
            restoreLatestChatOnMount={true}
            useLandingWhenEmpty={true}
            assessmentProgress={frameworkProgress}
            landingLayoutMode="overview"
            landingHeaderContent={(
              <ProjectOnboardingHeader
                initiative={initiative}
                filesUploaded={projectMaterials.length}
              />
            )}
            onEditorWidgetsChange={handleChatEditorWidgetsChange}
            onOpenDocument={openWorkspaceDocument}
            onOpenWorkspaceAssessment={handleOpenWorkspaceAssessment}
            onOpenAssumptions={openAssumptionsView}
          />
        );
      }

      return (
        <ProjectChatSurface
          key={researchLandingResetSignal}
          initiativeId={initiativeId}
          hideTiles={true}
          allowInitialProjectOnboarding={false}
          useLandingWhenEmpty={true}
          assessmentProgress={frameworkProgress}
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
          onOpenWorkspaceAssessment={handleOpenWorkspaceAssessment}
          onOpenAssumptions={openAssumptionsView}
        />
      );
    }

    if (activeView === 'assumptions') {
      return (
        <AssumptionsWorkspaceTab
          initiativeId={initiativeId}
          showDetailPanel={false}
          onAssumptionSelectInChat={handleOpenAssumptionInChat}
          onAddAssumptionInChat={handleAddAssumptionInChat}
          assessmentInstances={frameworkAssessmentInstances}
          onOpenAssessmentInstance={handleOpenExistingAssessmentInstanceInAssessmentsView}
        />
      );
    }

    if (activeView === 'framework') {
      if (!hasFrameworkSelection && !isViewer) {
        return (
          <ProjectChatTabsPanel
            initiativeId={initiativeId}
            researchMode={false}
            sessionStorageKey={frameworkChatTabsStorageKey}
            onEditorWidgetsChange={handleChatEditorWidgetsChange}
            onOpenDocument={openWorkspaceDocument}
            onOpenWorkspaceAssessment={handleOpenWorkspaceAssessment}
          pendingAssumptions={pendingAssumptionsRequest}
          onPendingAssumptionsHandled={() => setPendingAssumptionsRequest(null)}
          />
        );
      }

      if (!hasFrameworkSelection) {
        return (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-text-tertiary">No framework yet</p>
          </div>
        );
      }

      return (
        <div className="relative h-full flex flex-col bg-surface overflow-hidden">
          {frameworkProgress && frameworkProgress.total > 0 && (
            <AssessmentsProgressBar progress={frameworkProgress} />
          )}
          <div className="flex-1 min-h-0 overflow-hidden">
            <FrameworkPlanView
              plannedAssessmentIds={visibleFrameworkPlannedAssessmentIds}
              assessmentInstances={frameworkAssessmentInstances}
              loading={frameworkAssessmentsLoading}
              onAddAssessmentToFrameworkPlan={handleAddAssessmentToFrameworkPlan}
              onRemoveAssessmentFromFrameworkPlan={handleRemoveAssessmentFromFrameworkPlan}
              onCreateAssessmentInstanceInAssessmentsView={handleCreateAssessmentInstanceInAssessmentsView}
              onOpenExistingAssessmentInstanceInAssessmentsView={handleOpenExistingAssessmentInstanceInAssessmentsView}
              readOnly={Boolean(isViewer)}
              onOpenAssessment={(assessment) => {
                void handleOpenExistingAssessmentInstanceInAssessmentsView(assessment);
              }}
            />
          </div>
        </div>
      );
    }

    return <div className="h-full" />;
  })();

  const sideChatContent = sideChatMode === 'overview' ? (
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
          onOpenWorkspaceAssessment={handleOpenWorkspaceAssessment}
          onSendRef={chatSendRef}
          pendingAssumptions={pendingAssumptionsRequest}
          onPendingAssumptionsHandled={() => setPendingAssumptionsRequest(null)}
        />
      </div>
    </div>
  ) : sideChatMode === 'assessments' ? (
    <div className="h-full flex overflow-hidden">
      <div className="flex-1 min-w-0">
        <ProjectChatTabsPanel
          initiativeId={initiativeId}
          researchMode={false}
          sessionStorageKey={sideChatTabsStorageKey}
          pendingChatToOpen={pendingChatToOpen}
          activeAssessmentContext={activeAssessmentContext}
          onPendingSessionHandled={() => setPendingChatToOpen(null)}
          onEditorWidgetsChange={handleChatEditorWidgetsChange}
          onOpenDocument={openWorkspaceDocument}
          onOpenWorkspaceAssessment={handleOpenWorkspaceAssessment}
          onSendRef={chatSendRef}
          pendingDeepDive={assessmentsDeepDiveRequest ? {
            requestId: assessmentsDeepDiveRequest.requestId,
            state: assessmentsDeepDiveRequest.state,
          } : null}
          onPendingDeepDiveHandled={() => setAssessmentsDeepDiveRequest(null)}
          pendingAssessmentActivityLog={pendingAssessmentActivityLogRequest}
          onPendingAssessmentActivityLogHandled={() => setPendingAssessmentActivityLogRequest(null)}
          pendingAssumptions={pendingAssumptionsRequest}
          onPendingAssumptionsHandled={() => setPendingAssumptionsRequest(null)}
        />
      </div>
    </div>
  ) : sideChatMode === 'framework' ? (
    <div className="h-full flex overflow-hidden">
      <div className="flex-1 min-w-0">
        <ProjectChatTabsPanel
          initiativeId={initiativeId}
          researchMode={false}
          sessionStorageKey={sideChatTabsStorageKey}
          pendingChatToOpen={pendingChatToOpen}
          activeAssessmentContext={null}
          onPendingSessionHandled={() => setPendingChatToOpen(null)}
          onEditorWidgetsChange={handleChatEditorWidgetsChange}
          onOpenDocument={openWorkspaceDocument}
          onOpenWorkspaceAssessment={handleOpenWorkspaceAssessment}
          onSendRef={chatSendRef}
          pendingAssumptions={pendingAssumptionsRequest}
          onPendingAssumptionsHandled={() => setPendingAssumptionsRequest(null)}
        />
      </div>
    </div>
  ) : sideChatMode === 'assumptions' ? (
    <div className="h-full flex overflow-hidden">
      <div className="flex-1 min-w-0">
        <ProjectChatTabsPanel
          initiativeId={initiativeId}
          researchMode={false}
          sessionStorageKey={sideChatTabsStorageKey}
          pendingChatToOpen={pendingChatToOpen}
          activeAssessmentContext={null}
          onPendingSessionHandled={() => setPendingChatToOpen(null)}
          onEditorWidgetsChange={handleChatEditorWidgetsChange}
          onOpenDocument={openWorkspaceDocument}
          onOpenWorkspaceAssessment={handleOpenWorkspaceAssessment}
          onSendRef={chatSendRef}
          pendingAssumptions={pendingAssumptionsRequest}
          onPendingAssumptionsHandled={() => setPendingAssumptionsRequest(null)}
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
            leftToggle={chatHeaderToggle}
            rightToggle={workspaceHeaderToggle}
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
              {hasSideChatShell && (
                <>
                  <div
                    className="flex-shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out"
                    style={{ width: `${sideChatWidthPercent}%` }}
                  >
                    <div
                      className={`h-full w-full transition-all duration-300 ease-in-out ${sideChatOpen ? 'translate-x-0 opacity-100' : '-translate-x-6 opacity-0 pointer-events-none'}`}
                    >
                      <div
                        className={`h-full transition-opacity duration-200 ease-out ${sideChatOpen ? 'opacity-100' : 'opacity-0'}`}
                      >
                        {sideChatContent}
                      </div>
                    </div>
                  </div>

                  <div
                    onMouseDown={(event) => {
                      if (!showChatResizeHandle) return;
                      event.preventDefault();
                      setIsResizingChat(true);
                    }}
                    className={`flex-shrink-0 relative group transition-all duration-300 ease-in-out ${showChatResizeHandle ? 'w-2 cursor-col-resize opacity-100 translate-x-0' : 'w-0 opacity-0 pointer-events-none'} ${isResizingChat ? 'bg-accent/10' : ''}`}
                  >
                    <div className={`absolute left-1/2 top-0 h-full -translate-x-1/2 w-px transition-colors ${isResizingChat ? 'bg-accent/60' : 'bg-divider group-hover:bg-accent/40'}`} />
                  </div>
                </>
              )}

              {(showPrimaryPanel || hasSideChatShell) && (
                <div
                  className={`overflow-hidden transition-[width,opacity,transform] duration-300 ease-in-out ${showPrimaryPanel ? 'translate-x-0 opacity-100' : 'translate-x-6 opacity-0 pointer-events-none'}`}
                  style={{ width: `${primaryPanelWidthPercent}%` }}
                >
                  <div
                    className={`h-full min-w-0 transition-opacity duration-200 ease-out ${showPrimaryPanel ? 'opacity-100' : 'opacity-0'}`}
                  >
                    {primaryWorkspaceContent}
                  </div>
                </div>
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





