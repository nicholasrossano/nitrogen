'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ProjectChatSurface } from '@/components/core-chat/ProjectChatSurface';
import { ProjectOnboardingHeader } from '@/components/core-chat/ProjectOnboardingHeader';
import { PersonalChatSurface } from '@/components/chat-shell/PersonalChatSurface';
import { useChatShell } from '@/components/chat-shell/ChatShellContext';
import { ChangeProjectSelect } from '@/components/chat-shell/ChangeProjectSelect';
import { readLastProjectId, resolveActiveProjectId, useChatShellLandingReset, writeLastProjectId } from '@/components/chat-shell/ChatShellProvider';
import {
  ChatContextStack,
  type ChatContextExpandedWidget,
} from '@/components/chat-shell/ChatContextStack';
import {
  CONTEXT_PANEL_SEARCH_PARAM,
  contextStackBackdropMotionClass,
  contextStackTransitionClass,
  parseContextPanelParam,
  type ContextPanelExpandMotion,
  type ExpandedWidgetChangeOptions,
} from '@/components/chat-shell/chatContextStackMotion';
import { FloatLayer, type AssessmentLogContext, type FloatWidget } from '@/components/editor/FloatLayer';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import {
  floatWidgetForAssumption,
  floatWidgetForCitation,
  floatWidgetForProjectMaterial,
} from '@/lib/openProjectFileInEditor';
import { activeEditorContextFromWidget } from '@/lib/activeEditorContext';
import { api, type Assumption, type Project, type ProjectMaterial } from '@/lib/api';
import { projectDisplayName } from '@/lib/projectDisplayName';
import { discardEphemeralAssessmentInstance } from '@/lib/assessmentEngagement';
import { useProjectStore } from '@/stores/projectStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import {
  CHAT_CONTEXT_STACK_GUTTER,
  CHAT_FLOATING_PANEL_CHROME,
  clampChatEditorPanelWidth,
  chatEditorPanelGutter,
  readChatEditorPanelWidth,
  writeChatEditorPanelWidth,
} from '@/components/ui/chatSidebarLayout';
import { PageLoader } from '@/components/ui/PageLoader';

const FLOATING_PANEL_CLASS = `absolute z-20 right-3 flex flex-col min-h-0 overflow-hidden ${CHAT_FLOATING_PANEL_CHROME}`;
const SOLO_FLOAT_PANEL_CLASS = `absolute z-30 inset-y-3 left-0 right-3 flex flex-col min-h-0 overflow-hidden ${CHAT_FLOATING_PANEL_CHROME}`;
const RIGHT_MARGIN_PX = 12;

/** Docked = companion beside an active floor (Chat / Overview / Variables / Files). Solo = float owns the stage. */
type FloatLayout = 'docked' | 'solo';

function ChatWorkbenchContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const chatShell = useChatShell();
  const { activeWorkspace, loadWorkspaces } = useWorkspaceStore();

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [hasMessages, setHasMessages] = useState(false);
  const [floatWidgets, setFloatWidgets] = useState<FloatWidget[]>([]);
  const [pinnedFloatWidgets, setPinnedFloatWidgets] = useState<FloatWidget[] | null>(null);
  const [contextRefreshKey, setContextRefreshKey] = useState(0);
  const [expandedContextWidget, setExpandedContextWidget] = useState<ChatContextExpandedWidget | null>(null);
  const [expandMotionMode, setExpandMotionMode] = useState<ContextPanelExpandMotion>('stack');
  const [variablesFocusId, setVariablesFocusId] = useState<string | null>(null);
  const [floatPanelWidthPx, setFloatPanelWidthPx] = useState(readChatEditorPanelWidth);
  const [isResizingFloatPanel, setIsResizingFloatPanel] = useState(false);
  const [floatLayout, setFloatLayout] = useState<FloatLayout>('docked');
  const wasOnLandingRef = useRef(true);
  const ephemeralAssessmentSessionsRef = useRef<Map<string, { projectId: string; engaged: boolean }>>(new Map());

  const selectedProjectId = searchParams.get('project');
  const activeChatId = searchParams.get('chat');
  const panelParam = parseContextPanelParam(searchParams.get(CONTEXT_PANEL_SEARCH_PARAM));

  const replaceChatSearchParams = useCallback((mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const query = params.toString();
    router.replace(query ? `/chat?${query}` : '/chat');
  }, [router, searchParams]);

  const clearContextPanelParam = useCallback(() => {
    replaceChatSearchParams((params) => {
      params.delete(CONTEXT_PANEL_SEARCH_PARAM);
    });
  }, [replaceChatSearchParams]);

  useEffect(() => {
    if (!activeWorkspace) void loadWorkspaces();
  }, [activeWorkspace, loadWorkspaces]);

  useEffect(() => {
    if (!activeWorkspace?.id) {
      setProjects([]);
      setProjectsLoaded(false);
      return;
    }
    setProjectsLoaded(false);
    api.listProjects(100, 0, false, activeWorkspace.id)
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setProjectsLoaded(true));
  }, [activeWorkspace?.id, chatShell?.drawerRefreshKey]);

  useEffect(() => {
    if (!projectsLoaded || !activeWorkspace?.id || projects.length > 0) return;
    let cancelled = false;
    void api.createProject('New Project', activeWorkspace.id)
      .then((project) => {
        if (cancelled) return;
        setProjects([project]);
        writeLastProjectId(project.id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.id, projects.length, projectsLoaded]);

  const effectiveProjectId = useMemo(
    () => resolveActiveProjectId(pathname, selectedProjectId, projects),
    [pathname, projects, selectedProjectId],
  );

  useEffect(() => {
    if (!projectsLoaded || !effectiveProjectId) return;
    if (effectiveProjectId === selectedProjectId) return;

    const params = new URLSearchParams();
    params.set('project', effectiveProjectId);
    if (activeChatId) params.set('chat', activeChatId);
    const panel = searchParams.get(CONTEXT_PANEL_SEARCH_PARAM);
    if (panel) params.set(CONTEXT_PANEL_SEARCH_PARAM, panel);
    router.replace(`/chat?${params.toString()}`);
  }, [activeChatId, effectiveProjectId, projectsLoaded, router, searchParams, selectedProjectId]);

  useEffect(() => {
    if (effectiveProjectId) {
      void useProjectStore.getState().loadProject(effectiveProjectId);
      void useProjectStore.getState().loadMaterials(effectiveProjectId);
      writeLastProjectId(effectiveProjectId);
    }
  }, [effectiveProjectId]);

  useEffect(() => {
    setPinnedFloatWidgets(null);
    setFloatWidgets([]);
    setFloatLayout('docked');
    setExpandedContextWidget(null);
    setVariablesFocusId(null);
    setExpandMotionMode('stack');
  }, [effectiveProjectId]);

  useEffect(() => {
    if (activeChatId || !panelParam) return;
    // Stack expansions are local-only; ignore stale ?panel= until URL catches up on close.
    if (expandedContextWidget == null) return;
    if (expandedContextWidget != null && expandMotionMode === 'stack') return;
    if (expandedContextWidget === panelParam && expandMotionMode === 'center') return;

    setPinnedFloatWidgets(null);
    setFloatWidgets([]);
    setFloatLayout('docked');
    if (panelParam !== 'variables') {
      setVariablesFocusId(null);
    }
    setHasMessages(false);
    setExpandMotionMode('center');
    setExpandedContextWidget(panelParam);
    chatShell?.setActiveContextWidget(panelParam);
  }, [activeChatId, chatShell, expandMotionMode, expandedContextWidget, panelParam]);

  useEffect(() => {
    if (!activeChatId || !panelParam) return;
    clearContextPanelParam();
  }, [activeChatId, clearContextPanelParam, panelParam]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === effectiveProjectId) ?? null,
    [projects, effectiveProjectId],
  );

  const project = useProjectStore((s) => s.project);
  const projectPlan = useProjectStore((s) => s.projectPlan);
  const projectMaterials = useProjectStore((s) => s.projectMaterials);

  const isOnboarding = useMemo(() => {
    if (!effectiveProjectId || !project || project.id !== effectiveProjectId) return false;
    if (project.shared_role === 'viewer') return false;
    const hasFrameworkSelection = Boolean(
      projectPlan ||
      (project.selected_tools?.length ?? 0) > 0 ||
      project.project_plan,
    );
    return !hasFrameworkSelection;
  }, [effectiveProjectId, project, projectPlan]);

  const effectiveFloatWidgets = pinnedFloatWidgets ?? floatWidgets;
  const activeEditorContext = useMemo(
    () => activeEditorContextFromWidget(effectiveFloatWidgets[effectiveFloatWidgets.length - 1]),
    [effectiveFloatWidgets],
  );
  const showFloatLayer = effectiveFloatWidgets.length > 0;
  // A FloorLayer overlay (e.g. Variables) stays up when a companion float docks
  // beside it. The mini launcher stack only shows when no float or expanded floor owns the stage.
  const showContextStack = Boolean(effectiveProjectId)
    && (expandedContextWidget != null || (!showFloatLayer && (!hasMessages || panelParam != null)));
  const floatIsSolo = showFloatLayer && floatLayout === 'solo';
  const floatIsDocked = showFloatLayer && !floatIsSolo;
  const reserveRightSpace = (showContextStack && !expandedContextWidget) || floatIsDocked;
  const rightGutter = floatIsSolo
    ? undefined
    : showFloatLayer
      ? chatEditorPanelGutter(floatPanelWidthPx)
      : reserveRightSpace
        ? CHAT_CONTEXT_STACK_GUTTER
        : undefined;
  // Overlay floors shrink to leave room for a docked FloatLayer.
  const floorRightInset = floatIsDocked ? chatEditorPanelGutter(floatPanelWidthPx) : '0.75rem';

  const handleFloatResizeMove = useCallback((event: MouseEvent) => {
    const nextWidth = window.innerWidth - event.clientX - RIGHT_MARGIN_PX;
    setFloatPanelWidthPx(clampChatEditorPanelWidth(nextWidth));
  }, []);

  const handleFloatResizeEnd = useCallback(() => {
    setIsResizingFloatPanel(false);
  }, []);

  useEffect(() => {
    if (!isResizingFloatPanel) return;
    document.addEventListener('mousemove', handleFloatResizeMove);
    document.addEventListener('mouseup', handleFloatResizeEnd);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', handleFloatResizeMove);
      document.removeEventListener('mouseup', handleFloatResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [handleFloatResizeEnd, handleFloatResizeMove, isResizingFloatPanel]);

  useEffect(() => {
    if (isResizingFloatPanel) return;
    writeChatEditorPanelWidth(floatPanelWidthPx);
  }, [floatPanelWidthPx, isResizingFloatPanel]);

  const handleChangeProject = useCallback((projectId: string) => {
    if (!projectId || projectId === effectiveProjectId) return;
    writeLastProjectId(projectId);
    router.replace(`/chat?project=${projectId}`);
  }, [effectiveProjectId, router]);

  const changeProjectControl = useMemo(() => (
    projects.length > 0 ? (
      <ChangeProjectSelect
        projects={projects}
        value={effectiveProjectId}
        onChange={handleChangeProject}
      />
    ) : null
  ), [effectiveProjectId, handleChangeProject, projects]);

  const cleanupActiveEphemeralAssessment = useCallback((widgets: FloatWidget[]) => {
    const activeWidget = widgets[widgets.length - 1];
    if (
      activeWidget?.type !== 'assessment_workspace'
      || typeof activeWidget.data?.instance_id !== 'string'
      || !effectiveProjectId
    ) {
      return;
    }

    const instanceId = activeWidget.data.instance_id;
    const session = ephemeralAssessmentSessionsRef.current.get(instanceId);
    if (session && !session.engaged) {
      void discardEphemeralAssessmentInstance(session.projectId, instanceId);
    }
    ephemeralAssessmentSessionsRef.current.delete(instanceId);
  }, [effectiveProjectId]);

  const handleCloseFloatLayer = useCallback(() => {
    cleanupActiveEphemeralAssessment(pinnedFloatWidgets ?? floatWidgets);
    setPinnedFloatWidgets(null);
    setFloatWidgets([]);
    setFloatLayout('docked');
    // If a context panel (e.g. Variables) is still the floor, chat stays hidden behind it.
    if (!activeChatId && !expandedContextWidget) {
      setHasMessages(false);
    }
  }, [activeChatId, cleanupActiveEphemeralAssessment, floatWidgets, expandedContextWidget, pinnedFloatWidgets]);

  const handleAssessmentEngaged = useCallback((instanceId: string) => {
    const session = ephemeralAssessmentSessionsRef.current.get(instanceId);
    if (session) {
      session.engaged = true;
    }
  }, []);

  const handleFloatWidgetsChange = useCallback((widgets: FloatWidget[]) => {
    setFloatWidgets(widgets);
    if (widgets.length > 0) {
      setPinnedFloatWidgets(null);
      // Chat-emitted widgets are companions beside the active conversation.
      setFloatLayout('docked');
    }
  }, []);

  const resolveFloatLayoutForOpen = useCallback((): FloatLayout => {
    // Dock beside whichever floor is already active — an overlay FloorLayer
    // (Variables/Files/Overview), or Chat (messages on stage). Only a bare landing
    // with no floor content yet opens the float solo.
    if (expandedContextWidget != null || hasMessages) return 'docked';
    return 'solo';
  }, [expandedContextWidget, hasMessages]);

  const openPinnedFloat = useCallback((widgets: FloatWidget[], layout: FloatLayout) => {
    if (layout === 'solo') {
      // Bare landing — float owns the stage; dismiss any stale overlay floor.
      setExpandedContextWidget(null);
      setVariablesFocusId(null);
      setExpandMotionMode('stack');
      chatShell?.setActiveContextWidget(null);
      clearContextPanelParam();
      setHasMessages(true);
    }
    setFloatLayout(layout);
    setPinnedFloatWidgets(widgets);
  }, [chatShell, clearContextPanelParam]);

  /** Swap float contents in place (assessment → decision/activity log) without changing dock layout. */
  const replaceFloatContent = useCallback((widgets: FloatWidget[]) => {
    setPinnedFloatWidgets(widgets);
  }, []);

  const handleOpenDecisionLog = useCallback((context: AssessmentLogContext) => {
    replaceFloatContent([
      {
        type: 'decision_log',
        data: {
          instance_id: context.instanceId,
          assessment_id: context.assessmentId,
          title: `[Log] ${context.title}`,
        },
        messageId: `decision-log-${context.instanceId}`,
      },
    ]);
  }, [replaceFloatContent]);

  const handleOpenActivityLog = useCallback((context: AssessmentLogContext) => {
    replaceFloatContent([
      {
        type: 'activity_log',
        data: {
          instance_id: context.instanceId,
          assessment_id: context.assessmentId,
          title: context.title,
        },
        messageId: `activity-log-${context.instanceId}`,
      },
    ]);
  }, [replaceFloatContent]);

  const handleReopenAssessmentFromLog = useCallback((context: AssessmentLogContext) => {
    replaceFloatContent([
      {
        type: 'assessment_workspace',
        data: {
          instance_id: context.instanceId,
          assessment_id: context.assessmentId,
          title: context.title,
        },
        messageId: `workspace-${context.instanceId}`,
      },
    ]);
  }, [replaceFloatContent]);

  const handleExportDecisionLog = useCallback(async (context: AssessmentLogContext) => {
    const { blob, filename } = await api.exportAssessmentDecisionLogXlsx(context.instanceId);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleOpenDocument = useCallback((citation: ResearchPanelCitation) => {
    openPinnedFloat([floatWidgetForCitation(citation)], resolveFloatLayoutForOpen());
  }, [openPinnedFloat, resolveFloatLayoutForOpen]);

  const handleOpenAssumptionDetail = useCallback((assumption: Assumption) => {
    openPinnedFloat([floatWidgetForAssumption(assumption)], resolveFloatLayoutForOpen());
  }, [openPinnedFloat, resolveFloatLayoutForOpen]);

  const handleOpenWorkspaceAssessment = useCallback(
    (assessment: {
      instanceId: string;
      assessmentId: string;
      title?: string | null;
      pendingEngagement?: boolean;
    }) => {
      if (assessment.pendingEngagement && effectiveProjectId) {
        ephemeralAssessmentSessionsRef.current.set(assessment.instanceId, {
          projectId: effectiveProjectId,
          engaged: false,
        });
      }
      openPinnedFloat(
        [
          {
            type: 'assessment_workspace',
            data: {
              instance_id: assessment.instanceId,
              assessment_id: assessment.assessmentId,
              title: assessment.title,
              pending_engagement: assessment.pendingEngagement === true,
            },
            messageId: `workspace-${assessment.instanceId}`,
          },
        ],
        resolveFloatLayoutForOpen(),
      );
    },
    [effectiveProjectId, openPinnedFloat, resolveFloatLayoutForOpen],
  );

  const handleOpenProjectFile = useCallback((file: ProjectMaterial) => {
    openPinnedFloat([floatWidgetForProjectMaterial(file)], resolveFloatLayoutForOpen());
  }, [openPinnedFloat, resolveFloatLayoutForOpen]);

  const handleChatListDirty = useCallback(() => {
    chatShell?.refreshDrawer();
  }, [chatShell]);

  const handleChatIdResolved = useCallback((chatId: string) => {
    const params = new URLSearchParams();
    params.set('chat', chatId);
    if (effectiveProjectId) params.set('project', effectiveProjectId);
    router.replace(`/chat?${params.toString()}`);
    chatShell?.refreshDrawer();
  }, [chatShell, effectiveProjectId, router]);

  const resetLandingOverlays = useCallback((): boolean => {
    let didReset = false;

    if (expandedContextWidget || panelParam) {
      setExpandedContextWidget(null);
      setVariablesFocusId(null);
      setExpandMotionMode('stack');
      chatShell?.setActiveContextWidget(null);
      clearContextPanelParam();
      didReset = true;
    }

    if (pinnedFloatWidgets?.length || floatWidgets.length) {
      cleanupActiveEphemeralAssessment(pinnedFloatWidgets ?? floatWidgets);
      setPinnedFloatWidgets(null);
      setFloatWidgets([]);
      setFloatLayout('docked');
      didReset = true;
    }

    if (didReset && !activeChatId) {
      setHasMessages(false);
    }

    return didReset;
  }, [
    activeChatId,
    chatShell,
    cleanupActiveEphemeralAssessment,
    clearContextPanelParam,
    floatWidgets.length,
    expandedContextWidget,
    panelParam,
    pinnedFloatWidgets,
  ]);

  useChatShellLandingReset(resetLandingOverlays);

  const handleExpandedContextWidgetChange = useCallback((
    widget: ChatContextExpandedWidget | null,
    options?: ExpandedWidgetChangeOptions,
  ) => {
    const motion = options?.motion ?? (widget ? 'stack' : undefined);

    // A docked float is scoped to whichever floor is active; clear it on any floor
    // change, including closing the floor (e.g. Back on Variables → Chat).
    cleanupActiveEphemeralAssessment(pinnedFloatWidgets ?? floatWidgets);
    setPinnedFloatWidgets(null);
    setFloatLayout('docked');
    if (widget) {
      setFloatWidgets([]);
    }

    if (widget && motion === 'stack') {
      setExpandMotionMode('stack');
    } else if (widget) {
      setExpandMotionMode('center');
    } else {
      setExpandMotionMode('stack');
    }

    setExpandedContextWidget(widget);
    chatShell?.setActiveContextWidget(widget);

    if (widget && motion === 'center') {
      replaceChatSearchParams((params) => {
        params.delete('chat');
        if (effectiveProjectId) params.set('project', effectiveProjectId);
        params.set(CONTEXT_PANEL_SEARCH_PARAM, widget);
      });
      return;
    }

    if (searchParams.get(CONTEXT_PANEL_SEARCH_PARAM)) {
      clearContextPanelParam();
    }
  }, [
    chatShell,
    cleanupActiveEphemeralAssessment,
    clearContextPanelParam,
    floatWidgets,
    effectiveProjectId,
    pinnedFloatWidgets,
    replaceChatSearchParams,
    searchParams,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const bumpRefresh = () => setContextRefreshKey((k) => k + 1);
    window.addEventListener('nitrogen:assumption-updated', bumpRefresh);
    window.addEventListener('nitrogen:assumption-deleted', bumpRefresh);
    return () => {
      window.removeEventListener('nitrogen:assumption-updated', bumpRefresh);
      window.removeEventListener('nitrogen:assumption-deleted', bumpRefresh);
    };
  }, []);

  const chatSurfaceKey = expandMotionMode === 'center' && panelParam && !activeChatId
    ? `${effectiveProjectId}:${panelParam}`
    : effectiveProjectId;

  return (
    <div className="relative flex-1 flex flex-col min-h-0 min-w-0 h-full bg-surface">
      <div
        className={`flex-1 flex flex-col min-h-0 min-w-0 ${isResizingFloatPanel ? '' : 'transition-[padding-right] duration-300 ease-in-out'}`}
        style={{ paddingRight: rightGutter }}
      >
        <div
          className={`flex-1 min-h-0 ${contextStackTransitionClass} ${contextStackBackdropMotionClass(
            Boolean(expandedContextWidget) || floatIsSolo,
            expandedContextWidget ? expandMotionMode : 'center',
          )}`}
        >
          {effectiveProjectId ? (
            <ProjectChatSurface
              key={chatSurfaceKey}
              projectId={effectiveProjectId}
              initialChatId={activeChatId}
              useLandingWhenEmpty={!isOnboarding}
              hideTiles
              allowInitialProjectOnboarding={isOnboarding}
              restoreLatestChatOnMount={isOnboarding}
              landingLayoutMode="default"
              landingComposerTitle={isOnboarding ? undefined : projectDisplayName(selectedProject)}
              landingHeaderContent={<></>}
              onLandingStateChange={(onLanding) => {
                if (wasOnLandingRef.current && !onLanding && panelParam) {
                  clearContextPanelParam();
                } else if (panelParam && !activeChatId) {
                  setHasMessages(false);
                } else if (!panelParam) {
                  setHasMessages(!onLanding);
                }
                // Starting a chat while the float owns the stage docks it beside Chat (the default floor).
                if (!onLanding && floatLayout === 'solo') {
                  setFloatLayout('docked');
                }
                wasOnLandingRef.current = onLanding;
              }}
              onFloatWidgetsChange={handleFloatWidgetsChange}
              activeEditorContext={activeEditorContext}
              onOpenWorkspaceAssessment={handleOpenWorkspaceAssessment}
              onOpenDocument={handleOpenDocument}
              onChatMetaChange={({ chatId }) => {
                if (panelParam) return;
                if (chatId && chatId !== activeChatId) handleChatIdResolved(chatId);
              }}
              onChatListDirty={handleChatListDirty}
              composerLeadingActions={changeProjectControl}
            />
          ) : projectsLoaded ? (
            <PersonalChatSurface
              key="personal"
              initialChatId={activeChatId}
              useLandingWhenEmpty
              onLandingStateChange={(onLanding) => setHasMessages(!onLanding)}
              onChatListDirty={handleChatListDirty}
              onChatIdResolved={handleChatIdResolved}
              composerLeadingActions={changeProjectControl}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <PageLoader label="" />
            </div>
          )}
        </div>
      </div>

      {showContextStack && effectiveProjectId && (
        <ChatContextStack
          project={selectedProject}
          projectId={effectiveProjectId}
          refreshKey={contextRefreshKey}
          expandedWidget={expandedContextWidget}
          expandMotionMode={expandMotionMode}
          onExpandedWidgetChange={handleExpandedContextWidgetChange}
          variablesFocusId={variablesFocusId}
          onVariablesFocusIdChange={setVariablesFocusId}
          onOpenFile={handleOpenProjectFile}
          onOpenDocument={handleOpenDocument}
          onOpenAssumptionDetail={handleOpenAssumptionDetail}
          onOpenWorkspaceAssessment={handleOpenWorkspaceAssessment}
          rightInset={floorRightInset}
        />
      )}

      {showFloatLayer && effectiveProjectId && (
        <aside
          className={
            floatIsSolo
              ? `${SOLO_FLOAT_PANEL_CLASS} ${isResizingFloatPanel ? '' : 'transition-[width] duration-300 ease-in-out'}`
              : `${FLOATING_PANEL_CLASS} top-3 bottom-3 ${isResizingFloatPanel ? '' : 'transition-[width] duration-300 ease-in-out'}`
          }
          style={floatIsSolo ? undefined : { width: floatPanelWidthPx }}
        >
          {!floatIsSolo ? (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize float panel"
              onMouseDown={(event) => {
                event.preventDefault();
                setIsResizingFloatPanel(true);
              }}
              className={`absolute left-0 top-0 bottom-0 z-10 w-2 -translate-x-1/2 cursor-col-resize group ${isResizingFloatPanel ? 'bg-accent/10' : ''}`}
            >
              <div
                className={`absolute left-1/2 top-0 h-full w-px -translate-x-1/2 transition-colors ${isResizingFloatPanel ? 'bg-accent/60' : 'bg-divider group-hover:bg-accent/40'}`}
              />
            </div>
          ) : null}
          <FloatLayer
            widgets={effectiveFloatWidgets}
            projectId={effectiveProjectId}
            onClose={handleCloseFloatLayer}
            onAssessmentEngaged={handleAssessmentEngaged}
            onOpenDecisionLog={handleOpenDecisionLog}
            onOpenActivityLog={handleOpenActivityLog}
            onExportDecisionLog={handleExportDecisionLog}
            onOpenAssessment={handleReopenAssessmentFromLog}
          />
        </aside>
      )}

    </div>
  );
}

export default function ChatPage() {
  return (
    <ProtectedRoute>
      <ChatWorkbenchContent />
    </ProtectedRoute>
  );
}
