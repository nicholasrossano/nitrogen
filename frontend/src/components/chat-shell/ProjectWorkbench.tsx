'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProjectChatSurface } from '@/components/core-chat/ProjectChatSurface';
import { useChatShell } from '@/components/chat-shell/ChatShellContext';
import { useChatShellLandingReset, writeLastProjectId } from '@/components/chat-shell/ChatShellProvider';
import {
  ChatContextStack,
  type ChatContextExpandedWidget,
} from '@/components/chat-shell/ChatContextStack';
import {
  CONTEXT_PANEL_SEARCH_PARAM,
  buildProjectWorkbenchPath,
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
import { api, type Assumption, type AssessmentInstance, type ProjectMaterial } from '@/lib/api';
import { projectDisplayName } from '@/lib/projectDisplayName';
import { discardEphemeralAssessmentInstance } from '@/lib/assessmentEngagement';
import { getCached, swrFetch, swrKeys } from '@/lib/swrCache';
import { useProjectStore } from '@/stores/projectStore';
import {
  CHAT_CONTEXT_STACK_GUTTER,
  CHAT_FLOATING_PANEL_CHROME,
  clampChatEditorPanelWidth,
  chatEditorPanelGutter,
  readChatEditorPanelWidth,
  writeChatEditorPanelWidth,
} from '@/components/ui/chatSidebarLayout';

const FLOATING_PANEL_CLASS = `absolute z-20 right-3 flex flex-col min-h-0 overflow-hidden ${CHAT_FLOATING_PANEL_CHROME}`;
const SOLO_FLOAT_PANEL_CLASS = `absolute z-30 inset-y-3 left-0 right-3 flex flex-col min-h-0 overflow-hidden ${CHAT_FLOATING_PANEL_CHROME}`;
const RIGHT_MARGIN_PX = 12;

/** Docked = companion beside an active floor (Chat / Overview / Variables / Files / Assessments). Solo = float owns the stage. */
type FloatLayout = 'docked' | 'solo';

export function ProjectWorkbench({ projectId }: { projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const chatShell = useChatShell();

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
  const [frameworkAssessmentInstances, setFrameworkAssessmentInstances] = useState<AssessmentInstance[]>([]);
  const [frameworkAssessmentsLoading, setFrameworkAssessmentsLoading] = useState(false);
  const wasOnLandingRef = useRef(true);
  const ephemeralAssessmentSessionsRef = useRef<Map<string, { projectId: string; engaged: boolean }>>(new Map());
  /** Prevents re-opening a floor from a stale ?panel= while router.replace clears it. */
  const dismissingPanelRef = useRef<ChatContextExpandedWidget | null>(null);

  const activeChatId = searchParams.get('chat');
  const panelParam = parseContextPanelParam(searchParams.get(CONTEXT_PANEL_SEARCH_PARAM));

  const replaceWorkbenchSearchParams = useCallback((mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('project');
    params.delete('view');
    mutate(params);
    const chat = params.get('chat');
    const panel = parseContextPanelParam(params.get(CONTEXT_PANEL_SEARCH_PARAM));
    router.replace(buildProjectWorkbenchPath(projectId, { chat, panel }));
  }, [projectId, router, searchParams]);

  const clearContextPanelParam = useCallback(() => {
    replaceWorkbenchSearchParams((params) => {
      params.delete(CONTEXT_PANEL_SEARCH_PARAM);
    });
  }, [replaceWorkbenchSearchParams]);

  const dismissContextPanelParam = useCallback(() => {
    const current = parseContextPanelParam(searchParams.get(CONTEXT_PANEL_SEARCH_PARAM));
    if (current) dismissingPanelRef.current = current;
    clearContextPanelParam();
  }, [clearContextPanelParam, searchParams]);

  useEffect(() => {
    void useProjectStore.getState().loadProject(projectId);
    void useProjectStore.getState().loadMaterials(projectId);
    writeLastProjectId(projectId);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    const key = swrKeys.instances(projectId);
    const cached = getCached<AssessmentInstance[]>(key);
    if (cached) {
      setFrameworkAssessmentInstances(cached);
      setFrameworkAssessmentsLoading(false);
    } else {
      setFrameworkAssessmentsLoading(true);
    }
    void swrFetch(key, () => api.listAssessmentInstances(projectId), {
      force: contextRefreshKey > 0,
    })
      .then(({ data }) => {
        if (!cancelled) setFrameworkAssessmentInstances(data);
      })
      .catch(() => {
        if (!cancelled && !cached) setFrameworkAssessmentInstances([]);
      })
      .finally(() => {
        if (!cancelled) setFrameworkAssessmentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, contextRefreshKey]);

  useEffect(() => {
    setPinnedFloatWidgets(null);
    setFloatWidgets([]);
    setFloatLayout('docked');
    // Keep URL-driven floors (sidebar capsules) across project switches; only
    // reset stack expansions that aren't backed by ?panel=.
    if (!panelParam) {
      setExpandedContextWidget(null);
      setVariablesFocusId(null);
      setExpandMotionMode('stack');
    }
  }, [projectId, panelParam]);

  useEffect(() => {
    if (activeChatId) return;

    if (!panelParam) {
      dismissingPanelRef.current = null;
      // Stack expansions don't use the URL — don't tear them down when ?panel= is absent.
      if (expandMotionMode === 'center') {
        setExpandedContextWidget(null);
        chatShell?.setActiveContextWidget(null);
        setExpandMotionMode('stack');
      }
      return;
    }

    // Stale ?panel= still present while Back/dismiss is clearing the URL.
    // Capsule clicks set activeContextWidget first — honor that as a fresh open.
    if (dismissingPanelRef.current === panelParam) {
      if (chatShell?.activeContextWidget !== panelParam) return;
      dismissingPanelRef.current = null;
    }

    if (expandedContextWidget === panelParam && expandMotionMode === 'center') return;

    // Honor capsule / deep-link opens even when a stack floor is already up.
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
    dismissContextPanelParam();
  }, [activeChatId, dismissContextPanelParam, panelParam]);

  const project = useProjectStore((s) => s.project);
  const projectPlan = useProjectStore((s) => s.projectPlan);

  const cachedProject = useProjectStore((s) => s.projectsById[projectId] ?? null);

  // Prefer live store slot, then by-id cache — never paint "Untitled" for a known id.
  const selectedProject = project?.id === projectId ? project : cachedProject;

  const frameworkPlannedAssessmentIds = useMemo(() => {
    const fromProject = selectedProject?.selected_tools ?? project?.selected_tools ?? [];
    return Array.from(new Set(fromProject));
  }, [project?.selected_tools, selectedProject?.selected_tools]);

  const isOnboarding = useMemo(() => {
    if (!projectId || !project || project.id !== projectId) return false;
    if (project.shared_role === 'viewer') return false;
    const hasFrameworkSelection = Boolean(
      projectPlan ||
      (project.selected_tools?.length ?? 0) > 0 ||
      project.project_plan,
    );
    return !hasFrameworkSelection;
  }, [projectId, project, projectPlan]);

  const effectiveFloatWidgets = pinnedFloatWidgets ?? floatWidgets;
  const activeEditorContext = useMemo(
    () => activeEditorContextFromWidget(effectiveFloatWidgets[effectiveFloatWidgets.length - 1]),
    [effectiveFloatWidgets],
  );
  const showFloatLayer = effectiveFloatWidgets.length > 0;
  // A FloorLayer overlay (e.g. Variables) stays up when a companion float docks
  // beside it. The mini launcher stack only shows when no float or expanded floor owns the stage.
  const showContextStack = Boolean(projectId)
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

  const cleanupActiveEphemeralAssessment = useCallback((widgets: FloatWidget[]) => {
    const activeWidget = widgets[widgets.length - 1];
    if (
      activeWidget?.type !== 'assessment_workspace'
      || typeof activeWidget.data?.instance_id !== 'string'
      || !projectId
    ) {
      return;
    }

    const instanceId = activeWidget.data.instance_id;
    const session = ephemeralAssessmentSessionsRef.current.get(instanceId);
    if (session && !session.engaged) {
      void discardEphemeralAssessmentInstance(session.projectId, instanceId);
    }
    ephemeralAssessmentSessionsRef.current.delete(instanceId);
  }, [projectId]);

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
      dismissContextPanelParam();
      setHasMessages(true);
    }
    setFloatLayout(layout);
    setPinnedFloatWidgets(widgets);
  }, [chatShell, dismissContextPanelParam]);

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
      if (assessment.pendingEngagement && projectId) {
        ephemeralAssessmentSessionsRef.current.set(assessment.instanceId, {
          projectId,
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
    [projectId, openPinnedFloat, resolveFloatLayoutForOpen],
  );

  const handleAddAssessmentToFrameworkPlan = useCallback(async (assessmentId: string) => {
    const next = Array.from(new Set([...frameworkPlannedAssessmentIds, assessmentId]));
    await api.selectTools(projectId, next);
    await useProjectStore.getState().loadProject(projectId);
    setContextRefreshKey((k) => k + 1);
  }, [frameworkPlannedAssessmentIds, projectId]);

  const handleRemoveAssessmentFromFrameworkPlan = useCallback(async (assessmentId: string) => {
    const next = frameworkPlannedAssessmentIds.filter((id) => id !== assessmentId);
    await api.selectTools(projectId, next);
    await useProjectStore.getState().loadProject(projectId);
    setContextRefreshKey((k) => k + 1);
  }, [frameworkPlannedAssessmentIds, projectId]);

  const handleCreateAssessmentInstanceInAssessmentsView = useCallback(async (
    assessmentId: string,
    assessmentName: string,
  ) => {
    const instance = await api.createAssessmentInstance(projectId, assessmentId);
    setFrameworkAssessmentInstances((prev) => [...prev, instance]);
    handleOpenWorkspaceAssessment({
      instanceId: instance.id,
      assessmentId: instance.assessment_id,
      title: instance.display_name || assessmentName,
      pendingEngagement: true,
    });
  }, [handleOpenWorkspaceAssessment, projectId]);

  const handleOpenExistingAssessmentInstanceInAssessmentsView = useCallback(async (
    instance: AssessmentInstance,
  ) => {
    handleOpenWorkspaceAssessment({
      instanceId: instance.id,
      assessmentId: instance.assessment_id,
      title: instance.display_name || instance.title || instance.assessment_id.replace(/_/g, ' '),
    });
  }, [handleOpenWorkspaceAssessment]);

  const handleOpenProjectFile = useCallback((file: ProjectMaterial) => {
    openPinnedFloat([floatWidgetForProjectMaterial(file)], resolveFloatLayoutForOpen());
  }, [openPinnedFloat, resolveFloatLayoutForOpen]);

  const handleChatListDirty = useCallback(() => {
    chatShell?.refreshDrawer();
  }, [chatShell]);

  const handleChatIdResolved = useCallback((chatId: string) => {
    router.replace(buildProjectWorkbenchPath(projectId, { chat: chatId }));
    chatShell?.refreshDrawer();
  }, [chatShell, projectId, router]);

  const resetLandingOverlays = useCallback((): boolean => {
    let didReset = false;

    if (expandedContextWidget || panelParam) {
      setExpandedContextWidget(null);
      setVariablesFocusId(null);
      setExpandMotionMode('stack');
      chatShell?.setActiveContextWidget(null);
      dismissContextPanelParam();
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
    floatWidgets.length,
    expandedContextWidget,
    panelParam,
    pinnedFloatWidgets,
    dismissContextPanelParam,
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
      replaceWorkbenchSearchParams((params) => {
        params.delete('chat');
        params.set(CONTEXT_PANEL_SEARCH_PARAM, widget);
      });
      return;
    }

    if (searchParams.get(CONTEXT_PANEL_SEARCH_PARAM)) {
      dismissContextPanelParam();
    }
  }, [
    chatShell,
    cleanupActiveEphemeralAssessment,
    dismissContextPanelParam,
    floatWidgets,
    projectId,
    pinnedFloatWidgets,
    replaceWorkbenchSearchParams,
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

  // Replay tutorial: return to the landing chrome so welcome anchors are all mountable.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onReplay = () => {
      setExpandedContextWidget(null);
      setExpandMotionMode('stack');
      chatShell?.setActiveContextWidget(null);
      dismissContextPanelParam();
      setHasMessages(false);
      setFloatWidgets([]);
      setPinnedFloatWidgets(null);
      setFloatLayout('docked');
    };
    window.addEventListener('nitrogen:tour-replay', onReplay);
    return () => window.removeEventListener('nitrogen:tour-replay', onReplay);
  }, [chatShell, dismissContextPanelParam]);

  const chatSurfaceKey = projectId;

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
          <ProjectChatSurface
            key={chatSurfaceKey}
            projectId={projectId}
            initialChatId={activeChatId}
            useLandingWhenEmpty={!isOnboarding}
            hideTiles
            allowInitialProjectOnboarding={isOnboarding}
            restoreLatestChatOnMount={isOnboarding}
            landingLayoutMode="default"
            landingComposerTitle={
              isOnboarding || !selectedProject
                ? undefined
                : projectDisplayName(selectedProject)
            }
            landingHeaderContent={<></>}
            onLandingStateChange={(onLanding) => {
              if (panelParam && !activeChatId) {
                // URL floor is open — keep chat on landing under it.
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
            />
        </div>
      </div>

      {showContextStack && (
        <ChatContextStack
          project={selectedProject}
          projectId={projectId}
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
          frameworkPlannedAssessmentIds={frameworkPlannedAssessmentIds}
          frameworkAssessmentInstances={frameworkAssessmentInstances}
          frameworkAssessmentsLoading={frameworkAssessmentsLoading}
          onAddAssessmentToFrameworkPlan={handleAddAssessmentToFrameworkPlan}
          onRemoveAssessmentFromFrameworkPlan={handleRemoveAssessmentFromFrameworkPlan}
          onCreateAssessmentInstanceInAssessmentsView={handleCreateAssessmentInstanceInAssessmentsView}
          onOpenExistingAssessmentInstanceInAssessmentsView={handleOpenExistingAssessmentInstanceInAssessmentsView}
          frameworkReadOnly={project?.shared_role === 'viewer'}
        />
      )}

      {showFloatLayer && (
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
            projectId={projectId}
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

