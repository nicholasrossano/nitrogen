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
  ASSESSMENT_SEARCH_PARAM,
  CONTEXT_PANEL_SEARCH_PARAM,
  buildProjectWorkbenchPath,
  contextStackBackdropMotionClass,
  contextStackTransitionClass,
  parseAssessmentParam,
  parseContextPanelParam,
  type ContextPanelExpandMotion,
  type ExpandedWidgetChangeOptions,
} from '@/components/chat-shell/chatContextStackMotion';
import { FloatLayer, type AssessmentLogContext, type FloatWidget } from '@/components/editor/FloatLayer';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import {
  floatWidgetForCitation,
  floatWidgetForProjectMaterial,
  floatWidgetForVariablesWorkspace,
} from '@/lib/openProjectFileInEditor';
import { activeEditorContextFromWidget } from '@/lib/activeEditorContext';
import { api, type AssessmentInstance, type FieldContext, type ProjectMaterial } from '@/lib/api';
import { projectDisplayName } from '@/lib/projectDisplayName';
import { discardEphemeralAssessmentInstance } from '@/lib/assessmentEngagement';
import { assessmentHeaderTitle } from '@/lib/assessmentDisplay';
import { getCached, swrFetch, swrKeys } from '@/lib/swrCache';
import { useProjectStore } from '@/stores/projectStore';
import {
  CHAT_CONTEXT_STACK_GUTTER,
  CHAT_FLOATING_PANEL_CHROME,
  COMPANION_SIDE_PANEL_WIDTH_PX,
  clampChatEditorPanelWidth,
  chatEditorPanelGutter,
  readChatEditorPanelWidth,
  writeChatEditorPanelWidth,
} from '@/components/ui/chatSidebarLayout';

const FLOATING_PANEL_CLASS = `absolute z-20 right-3 flex flex-col min-h-0 overflow-hidden ${CHAT_FLOATING_PANEL_CHROME}`;
const SOLO_FLOAT_PANEL_CLASS = `absolute z-30 inset-y-3 left-0 right-3 flex flex-col min-h-0 overflow-hidden ${CHAT_FLOATING_PANEL_CHROME}`;
const RIGHT_MARGIN_PX = 12;

/** Docked = companion beside an active floor (Chat / Overview / Files / Assessments). Solo = float owns the stage. */
type FloatLayout = 'docked' | 'solo';

type PendingInvestigateAutoSend = {
  requestId: string;
  content: string;
  toolHint?: string;
  fieldContext?: FieldContext | null;
  modelInputsContext?: string | null;
  variableId?: string | null;
};

function floatWidgetsAreEqual(a: FloatWidget[], b: FloatWidget[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].messageId !== b[i].messageId || a[i].type !== b[i].type) return false;
    if (a[i].data !== b[i].data) return false;
  }
  return true;
}

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
  const [focusedVariableId, setFocusedVariableId] = useState<string | null>(null);
  const [pendingInvestigateAutoSend, setPendingInvestigateAutoSend] = useState<PendingInvestigateAutoSend | null>(null);
  const [floatPanelWidthPx, setFloatPanelWidthPx] = useState(readChatEditorPanelWidth);
  const [floatCompanionOpen, setFloatCompanionOpen] = useState(false);
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
  const assessmentParam = parseAssessmentParam(searchParams.get(ASSESSMENT_SEARCH_PARAM));
  const restoringAssessmentRef = useRef<string | null>(null);

  const replaceWorkbenchSearchParams = useCallback((mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('project');
    params.delete('view');
    mutate(params);
    const chat = params.get('chat');
    const panel = parseContextPanelParam(params.get(CONTEXT_PANEL_SEARCH_PARAM));
    const assessment = parseAssessmentParam(params.get(ASSESSMENT_SEARCH_PARAM));
    router.replace(buildProjectWorkbenchPath(projectId, { chat, panel, assessment }));
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
    restoringAssessmentRef.current = null;
    setFocusedVariableId(null);
    setPendingInvestigateAutoSend(null);
    // Keep URL-driven floors across project switches; only reset expansions
    // that aren't backed by ?panel=.
    if (!panelParam) {
      setExpandedContextWidget(null);
      setExpandMotionMode('stack');
    }
    // panelParam intentionally read only at project switch — panel changes are
    // handled by the ?panel= sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (activeChatId) return;

    if (!panelParam) {
      dismissingPanelRef.current = null;
      // Floors / variables float are URL-backed via ?panel= — tear down when absent.
      if (expandedContextWidget) {
        setExpandedContextWidget(null);
        chatShell?.setActiveContextWidget(null);
        setExpandMotionMode('stack');
      }
      setPinnedFloatWidgets((prev) => {
        if (!prev?.some((widget) => widget.type === 'variables_workspace')) return prev;
        const rest = prev.filter((widget) => widget.type !== 'variables_workspace');
        return rest.length > 0 ? rest : null;
      });
      setFloatCompanionOpen(false);
      return;
    }

    // Stale ?panel= still present while Back/dismiss is clearing the URL.
    // Capsule clicks set activeContextWidget first — honor that as a fresh open.
    if (dismissingPanelRef.current === panelParam) {
      if (chatShell?.activeContextWidget !== panelParam) return;
      dismissingPanelRef.current = null;
    }

    // Variables is a float, not a floor.
    if (panelParam === 'variables') {
      if (expandedContextWidget) {
        setExpandedContextWidget(null);
        setExpandMotionMode('stack');
      }
      chatShell?.setActiveContextWidget('variables');
      const alreadyOpen = (pinnedFloatWidgets ?? floatWidgets).some(
        (widget) => widget.type === 'variables_workspace',
      );
      if (!alreadyOpen) {
        const layout: FloatLayout = hasMessages ? 'docked' : 'solo';
        setFloatLayout(layout);
        if (layout === 'solo') {
          setHasMessages(true);
        }
        setPinnedFloatWidgets([floatWidgetForVariablesWorkspace(projectId)]);
      }
      return;
    }

    if (expandedContextWidget === panelParam) return;

    // Honor capsule / deep-link opens even when a stack floor is already up.
    // Keep an assessment float when restoring both ?panel= and ?assessment=.
    if (!assessmentParam) {
      setPinnedFloatWidgets(null);
      setFloatWidgets([]);
      setFloatLayout('docked');
      setFloatCompanionOpen(false);
    }
    setHasMessages(false);
    setExpandMotionMode('center');
    setExpandedContextWidget(panelParam);
    chatShell?.setActiveContextWidget(panelParam);
  }, [
    activeChatId,
    assessmentParam,
    chatShell,
    expandedContextWidget,
    floatWidgets,
    hasMessages,
    panelParam,
    pinnedFloatWidgets,
    projectId,
  ]);

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
  const activeAssessmentContext = useMemo(() => {
    for (let index = effectiveFloatWidgets.length - 1; index >= 0; index -= 1) {
      const widget = effectiveFloatWidgets[index];
      if (
        (widget.type === 'assessment_workspace'
          || widget.type === 'decision_log'
          || widget.type === 'activity_log')
        && typeof widget.data?.instance_id === 'string'
        && typeof widget.data?.assessment_id === 'string'
      ) {
        return {
          instanceId: widget.data.instance_id,
          assessmentId: widget.data.assessment_id,
          title: typeof widget.data.title === 'string' ? widget.data.title : null,
        };
      }
    }
    return null;
  }, [effectiveFloatWidgets]);
  const showFloatLayer = effectiveFloatWidgets.length > 0;

  const urlAssessmentInstanceId = useMemo(() => {
    for (let index = effectiveFloatWidgets.length - 1; index >= 0; index -= 1) {
      const widget = effectiveFloatWidgets[index];
      if (
        (widget.type === 'assessment_workspace'
          || widget.type === 'decision_log'
          || widget.type === 'activity_log')
        && typeof widget.data?.instance_id === 'string'
        && widget.data.instance_id
      ) {
        return widget.data.instance_id as string;
      }
    }
    return null;
  }, [effectiveFloatWidgets]);

  // Keep ?assessment= in sync with the open assessment float (refresh / share).
  useEffect(() => {
    if (urlAssessmentInstanceId) {
      if (assessmentParam === urlAssessmentInstanceId) return;
      replaceWorkbenchSearchParams((params) => {
        params.set(ASSESSMENT_SEARCH_PARAM, urlAssessmentInstanceId);
      });
      return;
    }
    if (!assessmentParam) return;
    // Don't clear a deep-link while restore is in flight.
    if (restoringAssessmentRef.current === assessmentParam) return;
    replaceWorkbenchSearchParams((params) => {
      params.delete(ASSESSMENT_SEARCH_PARAM);
    });
  }, [assessmentParam, replaceWorkbenchSearchParams, urlAssessmentInstanceId]);

  // Restore assessment float from ?assessment= after refresh.
  useEffect(() => {
    if (!assessmentParam) {
      restoringAssessmentRef.current = null;
      return;
    }
    const alreadyOpen = (pinnedFloatWidgets ?? floatWidgets).some(
      (widget) =>
        (widget.type === 'assessment_workspace'
          || widget.type === 'decision_log'
          || widget.type === 'activity_log')
        && widget.data?.instance_id === assessmentParam,
    );
    if (alreadyOpen) {
      restoringAssessmentRef.current = assessmentParam;
      return;
    }

    let cancelled = false;
    restoringAssessmentRef.current = assessmentParam;

    void api.listAssessmentInstances(projectId)
      .then((instances) => {
        if (cancelled) return;
        const instance = instances.find((item) => item.id === assessmentParam);
        if (!instance) {
          restoringAssessmentRef.current = null;
          replaceWorkbenchSearchParams((params) => {
            params.delete(ASSESSMENT_SEARCH_PARAM);
          });
          return;
        }
        const layout: FloatLayout = panelParam || activeChatId ? 'docked' : 'solo';
        setFloatLayout(layout);
        if (layout === 'solo') {
          setHasMessages(true);
        }
        setPinnedFloatWidgets([
          {
            type: 'assessment_workspace',
            data: {
              instance_id: instance.id,
              assessment_id: instance.assessment_id,
              title:
                instance.display_name
                || instance.title
                || instance.assessment_id.replace(/_/g, ' '),
            },
            messageId: `workspace-${instance.id}`,
          },
        ]);
      })
      .catch(() => {
        if (cancelled) return;
        restoringAssessmentRef.current = null;
        replaceWorkbenchSearchParams((params) => {
          params.delete(ASSESSMENT_SEARCH_PARAM);
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeChatId,
    assessmentParam,
    floatWidgets,
    panelParam,
    pinnedFloatWidgets,
    projectId,
    replaceWorkbenchSearchParams,
  ]);

  // A FloorLayer overlay stays up when a companion float docks beside it.
  // The mini launcher stack only shows when no float or expanded floor owns the stage.
  const showContextStack = Boolean(projectId)
    && (expandedContextWidget != null || (!showFloatLayer && (!hasMessages || panelParam != null)));
  const floatIsSolo = showFloatLayer && floatLayout === 'solo';
  const floatIsDocked = showFloatLayer && !floatIsSolo;
  const reserveRightSpace = (showContextStack && !expandedContextWidget) || floatIsDocked;
  // Grow the docked float when a companion column is open so content + side panel fit.
  const effectiveFloatPanelWidthPx = floatCompanionOpen
    ? clampChatEditorPanelWidth(floatPanelWidthPx + COMPANION_SIDE_PANEL_WIDTH_PX, {
      companionOpen: true,
    })
    : floatPanelWidthPx;
  const rightGutter = floatIsSolo
    ? undefined
    : showFloatLayer
      ? chatEditorPanelGutter(effectiveFloatPanelWidthPx)
      : reserveRightSpace
        ? CHAT_CONTEXT_STACK_GUTTER
        : undefined;
  // Overlay floors shrink to leave room for a docked FloatLayer.
  const floorRightInset = floatIsDocked ? chatEditorPanelGutter(effectiveFloatPanelWidthPx) : '0.75rem';

  // rAF-batched so a burst of native mousemove events (which can fire far faster
  // than the browser paints) collapses into one width commit per frame.
  const floatResizeFrameRef = useRef<number | null>(null);
  const floatResizePendingClientXRef = useRef<number | null>(null);

  const handleFloatResizeMove = useCallback((event: MouseEvent) => {
    floatResizePendingClientXRef.current = event.clientX;
    if (floatResizeFrameRef.current != null) return;
    floatResizeFrameRef.current = requestAnimationFrame(() => {
      floatResizeFrameRef.current = null;
      const clientX = floatResizePendingClientXRef.current;
      if (clientX == null) return;
      const nextTotalWidth = window.innerWidth - clientX - RIGHT_MARGIN_PX;
      // Persist the base (content) width; companion width is added on top when open.
      const nextBaseWidth = floatCompanionOpen
        ? nextTotalWidth - COMPANION_SIDE_PANEL_WIDTH_PX
        : nextTotalWidth;
      setFloatPanelWidthPx(clampChatEditorPanelWidth(nextBaseWidth));
    });
  }, [floatCompanionOpen]);

  const handleFloatResizeEnd = useCallback(() => {
    if (floatResizeFrameRef.current != null) {
      cancelAnimationFrame(floatResizeFrameRef.current);
      floatResizeFrameRef.current = null;
    }
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
    const closingVariables = (pinnedFloatWidgets ?? floatWidgets).some(
      (widget) => widget.type === 'variables_workspace',
    );
    setPinnedFloatWidgets(null);
    setFloatWidgets([]);
    setFloatLayout('docked');
    setFloatCompanionOpen(false);
    if (closingVariables && panelParam === 'variables') {
      chatShell?.setActiveContextWidget(null);
      dismissContextPanelParam();
    }
    // If a context panel is still the floor, chat stays hidden behind it.
    if (!activeChatId && !expandedContextWidget) {
      setHasMessages(false);
    }
  }, [
    activeChatId,
    chatShell,
    cleanupActiveEphemeralAssessment,
    dismissContextPanelParam,
    expandedContextWidget,
    floatWidgets,
    panelParam,
    pinnedFloatWidgets,
  ]);

  const handleAssessmentEngaged = useCallback((instanceId: string) => {
    const session = ephemeralAssessmentSessionsRef.current.get(instanceId);
    if (session) {
      session.engaged = true;
    }
  }, []);

  const handleFloatWidgetsChange = useCallback((widgets: FloatWidget[]) => {
    // Keep pinned floats (assessments opened from the stack / URL). Chat message
    // widget sync used to clear pinned state, which unmounted the assessment and
    // then ?assessment= restored it — a full remount that felt like random reloads.
    setFloatWidgets((prev) => (
      floatWidgetsAreEqual(prev, widgets) ? prev : widgets
    ));
  }, []);

  const resolveFloatLayoutForOpen = useCallback((): FloatLayout => {
    // Dock beside whichever floor is already active — an overlay FloorLayer
    // (Files/Overview/Assessments), or Chat (messages on stage). Only a bare landing
    // with no floor content yet opens the float solo.
    if (expandedContextWidget != null || hasMessages) return 'docked';
    return 'solo';
  }, [expandedContextWidget, hasMessages]);

  const openPinnedFloat = useCallback((widgets: FloatWidget[], layout: FloatLayout) => {
    const openingVariables = widgets.some((widget) => widget.type === 'variables_workspace');
    if (!openingVariables && panelParam === 'variables') {
      chatShell?.setActiveContextWidget(null);
      dismissContextPanelParam();
    }
    if (layout === 'solo') {
      // Bare landing — float owns the stage; dismiss any stale overlay floor.
      setExpandedContextWidget(null);
      setExpandMotionMode('stack');
      if (!openingVariables) {
        chatShell?.setActiveContextWidget(null);
        dismissContextPanelParam();
      }
      setHasMessages(true);
    }
    setFloatLayout(layout);
    setFloatCompanionOpen(false);
    setPinnedFloatWidgets(widgets);
  }, [chatShell, dismissContextPanelParam, panelParam]);

  const handleOpenVariablesWorkspace = useCallback((focusVariableId?: string | null) => {
    const layout = resolveFloatLayoutForOpen();
    setExpandedContextWidget(null);
    setExpandMotionMode('stack');
    chatShell?.setActiveContextWidget('variables');
    if (layout === 'solo') {
      setHasMessages(true);
    }
    setFloatLayout(layout);
    setFloatCompanionOpen(false);
    setPinnedFloatWidgets([floatWidgetForVariablesWorkspace(projectId, focusVariableId)]);
    replaceWorkbenchSearchParams((params) => {
      params.delete('chat');
      params.set(CONTEXT_PANEL_SEARCH_PARAM, 'variables');
    });
  }, [chatShell, projectId, replaceWorkbenchSearchParams, resolveFloatLayoutForOpen]);

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
      title: assessmentHeaderTitle(
        instance.title || instance.display_name,
        assessmentName,
        instance.creator_handle,
      ),
      pendingEngagement: true,
    });
  }, [handleOpenWorkspaceAssessment, projectId]);

  const handleOpenExistingAssessmentInstanceInAssessmentsView = useCallback(async (
    instance: AssessmentInstance,
  ) => {
    handleOpenWorkspaceAssessment({
      instanceId: instance.id,
      assessmentId: instance.assessment_id,
      title: assessmentHeaderTitle(
        instance.title || instance.display_name,
        instance.assessment_id.replace(/_/g, ' '),
        instance.creator_handle,
      ),
    });
  }, [handleOpenWorkspaceAssessment]);

  const handleAssessmentTitleChange = useCallback((instanceId: string, title: string) => {
    setFrameworkAssessmentInstances((prev) =>
      prev.map((inst) => {
        if (inst.id !== instanceId) return inst;
        const handle = inst.creator_handle?.trim();
        const displayName = handle ? `${title} · @${handle}` : title;
        return { ...inst, title, display_name: displayName };
      }),
    );
    const syncWidgetTitles = (widgets: FloatWidget[]) =>
      widgets.map((widget) => {
        if (widget.type !== 'assessment_workspace') return widget;
        if (widget.data?.instance_id !== instanceId) return widget;
        return { ...widget, data: { ...widget.data, title } };
      });
    setFloatWidgets((prev) => syncWidgetTitles(prev));
    setPinnedFloatWidgets((prev) => (prev ? syncWidgetTitles(prev) : prev));
  }, []);

  const handleOpenProjectFile = useCallback((file: ProjectMaterial) => {
    openPinnedFloat([floatWidgetForProjectMaterial(file)], resolveFloatLayoutForOpen());
  }, [openPinnedFloat, resolveFloatLayoutForOpen]);

  const handleChatListDirty = useCallback(() => {
    chatShell?.refreshDrawer();
  }, [chatShell]);

  const handleChatIdResolved = useCallback((chatId: string) => {
    router.replace(buildProjectWorkbenchPath(projectId, {
      chat: chatId,
      assessment: urlAssessmentInstanceId,
    }));
    chatShell?.refreshDrawer();
  }, [chatShell, projectId, router, urlAssessmentInstanceId]);

  const resetLandingOverlays = useCallback((): boolean => {
    let didReset = false;

    if (expandedContextWidget || panelParam) {
      setExpandedContextWidget(null);
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
      setFloatCompanionOpen(false);
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
    if (widget === 'variables') {
      handleOpenVariablesWorkspace(null);
      return;
    }

    const motion = options?.motion ?? (widget ? 'stack' : undefined);

    // A docked float is scoped to whichever floor is active; clear it on any floor
    // change, including closing the floor (e.g. Back on Files → Chat).
    cleanupActiveEphemeralAssessment(pinnedFloatWidgets ?? floatWidgets);
    setPinnedFloatWidgets(null);
    setFloatLayout('docked');
    setFloatCompanionOpen(false);
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

    if (widget) {
      // Persist floor in the URL for refresh / deep-link (stack and sidebar).
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
    handleOpenVariablesWorkspace,
    pinnedFloatWidgets,
    replaceWorkbenchSearchParams,
    searchParams,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const bumpRefresh = () => setContextRefreshKey((k) => k + 1);
    window.addEventListener('nitrogen:variable-updated', bumpRefresh);
    window.addEventListener('nitrogen:variable-deleted', bumpRefresh);
    return () => {
      window.removeEventListener('nitrogen:variable-updated', bumpRefresh);
      window.removeEventListener('nitrogen:variable-deleted', bumpRefresh);
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

  /** Make Chat the active floor beside any open assessment float (Investigate entry). */
  const revealChatFloorForInvestigate = useCallback(() => {
    if (expandedContextWidget || panelParam) {
      setExpandedContextWidget(null);
      setExpandMotionMode('stack');
      chatShell?.setActiveContextWidget(null);
      dismissContextPanelParam();
    }
    if (floatLayout === 'solo') {
      setFloatLayout('docked');
    }
    setHasMessages(true);
  }, [chatShell, dismissContextPanelParam, expandedContextWidget, floatLayout, panelParam]);

  // Investigate from assessment inputs: auto-send into the chat floor with field context.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const queueInvestigateSend = (detail: {
      text?: string | null;
      toolHint?: string | null;
      fieldContext?: FieldContext | null;
      modelInputsContext?: string | null;
      variableId?: string | null;
    }) => {
      const text = typeof detail.text === 'string' ? detail.text.trim() : '';
      if (!text) return;
      const fieldContext = detail.fieldContext ?? null;
      const variableId =
        detail.variableId
        ?? fieldContext?.variable_id
        ?? null;
      revealChatFloorForInvestigate();
      if (variableId) {
        setFocusedVariableId(variableId);
      }
      setPendingInvestigateAutoSend({
        requestId: `investigate-${fieldContext?.field_name ?? 'field'}-${Date.now()}`,
        content: text,
        toolHint: detail.toolHint ?? fieldContext?.assessment_id ?? undefined,
        fieldContext,
        modelInputsContext: detail.modelInputsContext ?? null,
        variableId,
      });
    };

    const onOpenVariableChat = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        variableId?: string | null;
        title?: string | null;
        text?: string | null;
        toolHint?: string | null;
        fieldContext?: FieldContext | null;
        modelInputsContext?: string | null;
      } | null;
      if (!detail?.variableId) return;
      queueInvestigateSend({
        text: detail.text,
        toolHint: detail.toolHint,
        fieldContext: detail.fieldContext ?? null,
        modelInputsContext: detail.modelInputsContext ?? null,
        variableId: detail.variableId,
      });
    };

    const onDraft = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        text?: string;
        toolHint?: string;
        fieldContext?: FieldContext | null;
        modelInputsContext?: string | null;
        _investigateAutoSend?: boolean;
        _workspaceForwarded?: boolean;
      } | null;
      // Only auto-send investigate drafts that carry field context. Plain drafts
      // still flow to ConversationView to populate the composer.
      if (!detail?.fieldContext?.field_name || !detail.text) return;
      if (detail._workspaceForwarded || detail._investigateAutoSend) return;
      detail._investigateAutoSend = true;
      queueInvestigateSend({
        text: detail.text,
        toolHint: detail.toolHint,
        fieldContext: detail.fieldContext,
        modelInputsContext: detail.modelInputsContext ?? null,
        variableId: detail.fieldContext.variable_id ?? null,
      });
    };

    window.addEventListener('nitrogen:open-variable-chat', onOpenVariableChat);
    // Capture so we mark investigate drafts before ConversationView fills the composer.
    window.addEventListener('nitrogen:draft', onDraft, true);
    return () => {
      window.removeEventListener('nitrogen:open-variable-chat', onOpenVariableChat);
      window.removeEventListener('nitrogen:draft', onDraft, true);
    };
  }, [revealChatFloorForInvestigate]);

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
            activeAssessmentContext={activeAssessmentContext}
            activeEditorContext={activeEditorContext}
            focusedVariableId={focusedVariableId}
            pendingAutoSend={pendingInvestigateAutoSend}
            onPendingAutoSendHandled={() => setPendingInvestigateAutoSend(null)}
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
          onOpenVariablesWorkspace={handleOpenVariablesWorkspace}
          onOpenFile={handleOpenProjectFile}
          onOpenDocument={handleOpenDocument}
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
          style={floatIsSolo ? undefined : { width: effectiveFloatPanelWidthPx }}
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
              className={`absolute left-0 top-0 bottom-0 z-10 w-2 cursor-col-resize group ${isResizingFloatPanel ? 'bg-accent/10' : ''}`}
            >
              <div
                className={`absolute left-0 top-0 h-full w-px transition-colors ${isResizingFloatPanel ? 'bg-accent/60' : 'bg-divider group-hover:bg-accent/40'}`}
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
            onAssessmentTitleChange={handleAssessmentTitleChange}
            onCompanionSidePanelOpenChange={setFloatCompanionOpen}
            onOpenDocument={handleOpenDocument}
            onOpenFile={handleOpenProjectFile}
          />
        </aside>
      )}

      {isResizingFloatPanel && (
        // Transparent shield above everything (including embedded document
        // iframes) so drag mousemove/mouseup always land on this document
        // instead of being swallowed by the iframe's own browsing context.
        <div className="fixed inset-0 z-[100] cursor-col-resize" aria-hidden="true" />
      )}
    </div>
  );
}

