'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Maximize2, MessageCircle, PanelRight } from 'lucide-react';
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
  VARIABLE_SEARCH_PARAM,
  buildProjectWorkbenchPath,
  contextStackBackdropMotionClass,
  contextStackTransitionClass,
  parseAssessmentParam,
  parseContextPanelParam,
  parseVariableParam,
  type ContextPanelExpandMotion,
  type ExpandedWidgetChangeOptions,
} from '@/components/chat-shell/chatContextStackMotion';
import { FloatLayer, type AssessmentLogContext, type FloatWidget } from '@/components/editor/FloatLayer';
import { FloatTabBar } from '@/components/editor/FloatTabBar';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import {
  floatWidgetForAssessmentReport,
  floatWidgetForCitation,
  floatWidgetForProjectMaterial,
  floatWidgetForVariable,
} from '@/lib/openProjectFileInEditor';
import {
  clearPersistedFloatSession,
  closeFloatTabInSession,
  findFloatTabIndex,
  floatTabDedupeKey,
  floatTabKeepAliveIds,
  openFloatTabInSession,
  readPersistedFloatSession,
  replaceFloatTabInSession,
  touchFloatTabRecentOrder,
  writePersistedFloatSession,
} from '@/lib/floatTabSession';
import { activeEditorContextFromWidget } from '@/lib/activeEditorContext';
import { api, type AssessmentInstance, type FieldContext, type ProjectMaterial, type Variable } from '@/lib/api';
import { projectDisplayName } from '@/lib/projectDisplayName';
import { discardEphemeralAssessmentInstance } from '@/lib/assessmentEngagement';
import { assessmentHeaderTitle } from '@/lib/assessmentDisplay';
import { getCached, swrFetch, swrKeys } from '@/lib/swrCache';
import { useProjectStore } from '@/stores/projectStore';
import {
  CHAT_CONTEXT_STACK_GUTTER,
  CHAT_EDITOR_PANEL_MAX_CONTENT_RATIO,
  CHAT_FLOATING_PANEL_CHROME,
  clampChatEditorPanelWidth,
  chatEditorPanelGutter,
  readChatEditorPanelWidth,
  writeChatEditorPanelWidth,
} from '@/components/ui/chatSidebarLayout';

/**
 * Outer float stack (tab bar + card). Width is always explicit so docked↔companion can
 * animate. Top inset is set inline (not top-3) — see floatDockedTopInset — because it
 * must vary with what's docked beside it: FloorLayer overlays (Overview/Variables/Files/
 * Assessments) sit inset-y-3, but Chat itself renders flush at the very top of the
 * workbench with no inset. Hardcoding top-3 here would only line up the float card's
 * top edge with a FloorLayer's header divider, not Chat's.
 */
const FLOATING_STACK_CLASS = 'absolute right-3 bottom-3 flex flex-col min-h-0';
/** Bare-landing solo: fill the stage with insets (no measured width required). */
const SOLO_FLOAT_STACK_CLASS = 'absolute z-30 inset-y-3 left-0 right-3 flex flex-col min-h-0';
const FLOAT_CARD_CLASS = `flex min-h-0 flex-1 flex-col overflow-hidden ${CHAT_FLOATING_PANEL_CHROME}`;
const RIGHT_MARGIN_PX = 12;

/** Docked = companion beside an active floor (Chat / Overview / Variables / Files / Assessments). Solo = float owns the stage. */
type FloatLayout = 'docked' | 'solo';

/** A draft to populate into the chat composer (e.g. from an Investigate click) - never auto-sent. */
type PendingInvestigateDraft = {
  requestId: string;
  content: string;
  toolHint?: string;
  fieldContext?: FieldContext | null;
  modelInputsContext?: string | null;
  variableId?: string | null;
};

function isAssessmentLinkedFloat(widget: FloatWidget): boolean {
  return (
    widget.type === 'assessment_workspace'
    || widget.type === 'decision_log'
    || widget.type === 'activity_log'
    || (widget.type === 'document_viewer' && Boolean(widget.data?.instance_id))
  );
}

function cleanupEphemeralForWidget(
  widget: FloatWidget | null | undefined,
  projectId: string,
  sessions: Map<string, { projectId: string; engaged: boolean }>,
) {
  if (
    widget?.type !== 'assessment_workspace'
    || typeof widget.data?.instance_id !== 'string'
    || !projectId
  ) {
    return;
  }
  const instanceId = widget.data.instance_id;
  const session = sessions.get(instanceId);
  if (session && !session.engaged) {
    void discardEphemeralAssessmentInstance(session.projectId, instanceId);
  }
  sessions.delete(instanceId);
}

export function ProjectWorkbench({ projectId }: { projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const chatShell = useChatShell();

  const [hasMessages, setHasMessages] = useState(false);
  /** Browser-like float session — open adds/focuses a tab; nested nav replaces the active tab. */
  const [floatTabs, setFloatTabs] = useState<FloatWidget[]>([]);
  const [activeFloatTabId, setActiveFloatTabId] = useState<string | null>(null);
  /** Oldest → newest tab ids for LRU eviction / keep-alive. */
  const [floatTabRecentOrder, setFloatTabRecentOrder] = useState<string[]>([]);
  /** Header X hides the float window without discarding tabs; open / Open Editor reveals it. */
  const [floatLayerHidden, setFloatLayerHidden] = useState(false);
  const [contextRefreshKey, setContextRefreshKey] = useState(0);
  const [expandedContextWidget, setExpandedContextWidget] = useState<ChatContextExpandedWidget | null>(null);
  const [expandMotionMode, setExpandMotionMode] = useState<ContextPanelExpandMotion>('stack');
  const [focusedVariableId, setFocusedVariableId] = useState<string | null>(null);
  const [pendingInvestigateDraft, setPendingInvestigateDraft] = useState<PendingInvestigateDraft | null>(null);
  const [floatPanelWidthPx, setFloatPanelWidthPx] = useState(readChatEditorPanelWidth);
  const [floatCompanionOpen, setFloatCompanionOpen] = useState(false);
  /** User-driven stage cover (Full screen button). Separate from assessment companion columns. */
  const [floatStageExpanded, setFloatStageExpanded] = useState(false);
  /** Last float session closed this session — floor-only "Open Editor" reopens it. */
  const [lastFloatSession, setLastFloatSession] = useState<{
    tabs: FloatWidget[];
    activeTabId: string | null;
  } | null>(null);
  const [isResizingFloatPanel, setIsResizingFloatPanel] = useState(false);
  const [floatLayout, setFloatLayout] = useState<FloatLayout>('docked');
  const [workbenchWidthPx, setWorkbenchWidthPx] = useState(0);
  const [frameworkAssessmentInstances, setFrameworkAssessmentInstances] = useState<AssessmentInstance[]>([]);
  const [frameworkAssessmentsLoading, setFrameworkAssessmentsLoading] = useState(false);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const wasOnLandingRef = useRef(true);
  const ephemeralAssessmentSessionsRef = useRef<Map<string, { projectId: string; engaged: boolean }>>(new Map());
  /** Prevents re-opening a floor from a stale ?panel= while router.replace clears it. */
  const dismissingPanelRef = useRef<ChatContextExpandedWidget | null>(null);

  const activeChatId = searchParams.get('chat');
  const panelParam = parseContextPanelParam(searchParams.get(CONTEXT_PANEL_SEARCH_PARAM));
  const assessmentParam = parseAssessmentParam(searchParams.get(ASSESSMENT_SEARCH_PARAM));
  const variableParam = parseVariableParam(searchParams.get(VARIABLE_SEARCH_PARAM));
  // First-message handoff from /projects/new — sent once, then stripped from the URL.
  const seedParam = searchParams.get('seed');
  const handleSeedHandled = useCallback(() => {
    router.replace(buildProjectWorkbenchPath(projectId));
  }, [projectId, router]);
  /** Guards against re-entrant fetch+open for the same in-flight ?assessment= restore. */
  const restoringAssessmentRef = useRef<string | null>(null);

  // router.replace is async and next/navigation's searchParams only catches up once it
  // resolves. Two calls issued close together (e.g. switching floors, then opening an
  // assessment a moment later) would otherwise each branch off the same stale rendered
  // searchParams, so the second call's URL silently drops whatever the first one just
  // changed — reverting a floor switch, resurrecting a just-cleared ?chat=, etc. Chaining
  // every write off the previous call's OWN result (instead of off the last render) makes
  // back-to-back writes compose instead of clobbering each other.
  const pendingSearchParamsRef = useRef<URLSearchParams | null>(null);

  useEffect(() => {
    // Real navigation landed (ours or external/back-forward) — searchParams is now the
    // freshest ground truth; drop any optimistic base so the next write re-branches off it.
    pendingSearchParamsRef.current = null;
  }, [searchParams]);

  const getLatestSearchParams = useCallback(
    () => pendingSearchParamsRef.current ?? searchParams,
    [searchParams],
  );

  const replaceWorkbenchSearchParams = useCallback((mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(getLatestSearchParams().toString());
    params.delete('project');
    params.delete('view');
    mutate(params);
    pendingSearchParamsRef.current = params;
    const chat = params.get('chat');
    const panel = parseContextPanelParam(params.get(CONTEXT_PANEL_SEARCH_PARAM));
    const assessment = parseAssessmentParam(params.get(ASSESSMENT_SEARCH_PARAM));
    const variable = parseVariableParam(params.get(VARIABLE_SEARCH_PARAM));
    router.replace(buildProjectWorkbenchPath(projectId, { chat, panel, assessment, variable }));
  }, [getLatestSearchParams, projectId, router]);

  const clearContextPanelParam = useCallback(() => {
    replaceWorkbenchSearchParams((params) => {
      params.delete(CONTEXT_PANEL_SEARCH_PARAM);
      params.delete(VARIABLE_SEARCH_PARAM);
    });
  }, [replaceWorkbenchSearchParams]);

  const dismissContextPanelParam = useCallback(() => {
    const current = parseContextPanelParam(getLatestSearchParams().get(CONTEXT_PANEL_SEARCH_PARAM));
    if (current) dismissingPanelRef.current = current;
    clearContextPanelParam();
  }, [clearContextPanelParam, getLatestSearchParams]);

  const floatSessionRef = useRef({
    tabs: floatTabs,
    activeTabId: activeFloatTabId,
    recentOrder: floatTabRecentOrder,
  });
  floatSessionRef.current = {
    tabs: floatTabs,
    activeTabId: activeFloatTabId,
    recentOrder: floatTabRecentOrder,
  };

  /**
   * Tracks the assessment id we last intended for ?assessment= — synchronously, from
   * commitFloatSession's own bookkeeping, never from the (async, occasionally
   * out-of-order-resolving) URL itself. Used only to skip redundant writes; never to
   * decide whether to reactivate a tab, so it can't race with router.replace timing.
   */
  const lastCommittedAssessmentIdRef = useRef<string | null>(null);

  /**
   * commitFloatSession is the single place tabs/active-tab state changes. It also owns
   * ?assessment= sync, mirroring only the ACTIVE tab (real browser address bars ignore
   * background tabs). This is a pure one-way write: nothing reactively reads ?assessment=
   * to re-derive the active tab (see the mount/popstate-only restore below), so there is
   * no feedback loop for router.replace's async, occasionally out-of-order resolution to
   * race against — which was the root cause of both the two-tab flicker and tab switches
   * silently snapping back to a previously-active assessment.
   *
   * Also persists the session to sessionStorage so a hard refresh restores every open
   * tab, not just whichever one happens to be mirrored in ?assessment=/?variable=.
   */
  const commitFloatSession = useCallback((
    tabs: FloatWidget[],
    activeTabId: string | null,
    recentOrder: string[],
    evicted?: FloatWidget | null,
  ) => {
    if (evicted) {
      cleanupEphemeralForWidget(evicted, projectId, ephemeralAssessmentSessionsRef.current);
    }
    setFloatTabs(tabs);
    setActiveFloatTabId(activeTabId);
    setFloatTabRecentOrder(recentOrder);
    floatSessionRef.current = { tabs, activeTabId, recentOrder };
    writePersistedFloatSession(projectId, { tabs, activeTabId, recentOrder });
    // Any session mutation that leaves tabs visible should reveal a hidden layer.
    if (tabs.length > 0) {
      setFloatLayerHidden(false);
    }

    const active = activeTabId
      ? tabs.find((tab) => floatTabDedupeKey(tab) === activeTabId)
      : tabs[tabs.length - 1];
    const nextAssessmentId =
      active && isAssessmentLinkedFloat(active) && typeof active.data?.instance_id === 'string'
        ? (active.data.instance_id as string)
        : null;

    if (nextAssessmentId === lastCommittedAssessmentIdRef.current) return;
    lastCommittedAssessmentIdRef.current = nextAssessmentId;

    if (nextAssessmentId) {
      replaceWorkbenchSearchParams((params) => {
        params.set(ASSESSMENT_SEARCH_PARAM, nextAssessmentId);
      });
    } else {
      replaceWorkbenchSearchParams((params) => {
        params.delete(ASSESSMENT_SEARCH_PARAM);
      });
    }
  }, [projectId, replaceWorkbenchSearchParams]);

  const openFloatTab = useCallback((widget: FloatWidget) => {
    const { tabs, activeTabId, recentOrder } = floatSessionRef.current;
    const result = openFloatTabInSession(tabs, activeTabId, widget, recentOrder);
    const nextRecent = touchFloatTabRecentOrder(
      result.evicted
        ? recentOrder.filter((id) => floatTabDedupeKey(result.evicted!) !== id)
        : recentOrder,
      result.activeTabId,
    );
    commitFloatSession(result.tabs, result.activeTabId, nextRecent, result.evicted);
  }, [commitFloatSession]);

  const activateFloatTab = useCallback((tabId: string) => {
    const { tabs, recentOrder } = floatSessionRef.current;
    if (findFloatTabIndex(tabs, tabId) < 0) return;
    commitFloatSession(tabs, tabId, touchFloatTabRecentOrder(recentOrder, tabId));
  }, [commitFloatSession]);

  const replaceActiveFloatTab = useCallback((widget: FloatWidget) => {
    const { tabs, activeTabId, recentOrder } = floatSessionRef.current;
    const result = replaceFloatTabInSession(tabs, activeTabId, widget);
    commitFloatSession(
      result.tabs,
      result.activeTabId,
      touchFloatTabRecentOrder(recentOrder, result.activeTabId),
    );
  }, [commitFloatSession]);

  const clearFloatSession = useCallback(() => {
    const { tabs } = floatSessionRef.current;
    for (const tab of tabs) {
      cleanupEphemeralForWidget(tab, projectId, ephemeralAssessmentSessionsRef.current);
    }
    commitFloatSession([], null, []);
    setFloatLayerHidden(false);
    // Explicit close/reset should not resurrect the session on the next refresh.
    clearPersistedFloatSession(projectId);
  }, [commitFloatSession, projectId]);

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
    setFloatLayerHidden(false);
    setLastFloatSession(null);
    setFloatLayout('docked');
    setFloatCompanionOpen(false);
    setFloatStageExpanded(false);
    restoringAssessmentRef.current = null;
    lastCommittedAssessmentIdRef.current = null;
    setFocusedVariableId(null);
    setPendingInvestigateDraft(null);

    // Restore a float session left over from before a hard refresh (or a prior visit
    // to this project this browser tab) rather than always wiping it — refreshing
    // should not silently close every tab except whatever ?assessment=/?variable=
    // happens to name. commitFloatSession updates lastCommittedAssessmentIdRef itself,
    // so this must run after the refs above are cleared, not before.
    const restored = readPersistedFloatSession(projectId);
    if (restored) {
      commitFloatSession(restored.tabs, restored.activeTabId, restored.recentOrder);
    } else {
      setFloatTabs([]);
      setActiveFloatTabId(null);
      setFloatTabRecentOrder([]);
      floatSessionRef.current = { tabs: [], activeTabId: null, recentOrder: [] };
    }
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
    // Selecting a chat from history clears ?panel= in the URL, but this effect used
    // to early-return on activeChatId and leave expandedContextWidget set — Overview
    // (etc.) stayed covering Chat. Dismiss the floor whenever a chat is active.
    //
    // activeChatId/panelParam come from next/navigation's searchParams, which only
    // catches up once a pending router.replace actually resolves. Immediately after a
    // floor switch (which deletes ?chat= and sets ?panel=) this effect re-runs (because
    // expandedContextWidget just changed) while those values are still momentarily
    // stale — so it would see the OLD ?chat= and revert the floor switch it's reacting
    // to. Prefer our own in-flight intent (pendingSearchParamsRef) when there is one.
    const pending = pendingSearchParamsRef.current;
    const effectiveActiveChatId = pending ? pending.get('chat') : activeChatId;
    const effectivePanelParam = pending
      ? parseContextPanelParam(pending.get(CONTEXT_PANEL_SEARCH_PARAM))
      : panelParam;

    if (effectiveActiveChatId) {
      if (expandedContextWidget) {
        setExpandedContextWidget(null);
        setExpandMotionMode('stack');
        chatShell?.setActiveContextWidget(null);
      }
      if (effectivePanelParam) {
        dismissContextPanelParam();
      }
      return;
    }

    if (!effectivePanelParam) {
      dismissingPanelRef.current = null;
      // Floors are URL-backed via ?panel= — tear down when the param is absent.
      // Float tabs are a browser-like session independent of which floor is showing;
      // they are only removed by an explicit tab/session close, never by floor nav.
      if (expandedContextWidget) {
        setExpandedContextWidget(null);
        chatShell?.setActiveContextWidget(null);
        setExpandMotionMode('stack');
      }
      return;
    }

    // Stale ?panel= still present while Back/dismiss is clearing the URL.
    // Capsule clicks set activeContextWidget first — honor that as a fresh open.
    if (dismissingPanelRef.current === effectivePanelParam) {
      if (chatShell?.activeContextWidget !== effectivePanelParam) return;
      dismissingPanelRef.current = null;
    }

    if (expandedContextWidget === effectivePanelParam) return;

    // Honor capsule / deep-link opens even when a stack floor is already up.
    setFloatLayout('docked');
    setFloatCompanionOpen(false);
    setFloatStageExpanded(false);
    setHasMessages(false);
    setExpandMotionMode('center');
    setExpandedContextWidget(effectivePanelParam);
    chatShell?.setActiveContextWidget(effectivePanelParam);
  }, [
    activeChatId,
    chatShell,
    dismissContextPanelParam,
    expandedContextWidget,
    panelParam,
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

  const showFloatLayer = floatTabs.length > 0 && !floatLayerHidden;
  const activeFloatWidget = useMemo(() => {
    if (!floatTabs.length) return null;
    if (activeFloatTabId) {
      const match = floatTabs.find((tab) => floatTabDedupeKey(tab) === activeFloatTabId);
      if (match) return match;
    }
    return floatTabs[floatTabs.length - 1];
  }, [activeFloatTabId, floatTabs]);

  const floatKeepAliveTabIds = useMemo(
    () => floatTabKeepAliveIds(floatTabRecentOrder, activeFloatTabId),
    [activeFloatTabId, floatTabRecentOrder],
  );

  // Remember the latest open float so floor-only "Open Editor" can restore it.
  useEffect(() => {
    if (floatTabs.length === 0) return;
    setLastFloatSession({ tabs: floatTabs, activeTabId: activeFloatTabId });
  }, [activeFloatTabId, floatTabs]);

  const activeEditorContext = useMemo(
    () => activeEditorContextFromWidget(activeFloatWidget),
    [activeFloatWidget],
  );
  const activeAssessmentContext = useMemo(() => {
    if (!activeFloatWidget) {
      // Prefer any open assessment-linked tab if the active tab is a plain doc.
      for (let index = floatTabs.length - 1; index >= 0; index -= 1) {
        const widget = floatTabs[index];
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
    }
    if (
      (activeFloatWidget.type === 'assessment_workspace'
        || activeFloatWidget.type === 'decision_log'
        || activeFloatWidget.type === 'activity_log')
      && typeof activeFloatWidget.data?.instance_id === 'string'
      && typeof activeFloatWidget.data?.assessment_id === 'string'
    ) {
      return {
        instanceId: activeFloatWidget.data.instance_id,
        assessmentId: activeFloatWidget.data.assessment_id,
        title: typeof activeFloatWidget.data.title === 'string' ? activeFloatWidget.data.title : null,
      };
    }
    return null;
  }, [activeFloatWidget, floatTabs]);

  const urlAssessmentInstanceId = useMemo(() => {
    const source = activeFloatWidget && isAssessmentLinkedFloat(activeFloatWidget)
      ? activeFloatWidget
      : null;
    if (source && typeof source.data?.instance_id === 'string' && source.data.instance_id) {
      return source.data.instance_id as string;
    }
    for (let index = floatTabs.length - 1; index >= 0; index -= 1) {
      const widget = floatTabs[index];
      if (isAssessmentLinkedFloat(widget) && typeof widget.data?.instance_id === 'string' && widget.data.instance_id) {
        return widget.data.instance_id as string;
      }
    }
    return null;
  }, [activeFloatWidget, floatTabs]);

  /**
   * Restore/activate an assessment float from a given ?assessment= id. Called ONLY from
   * genuinely external triggers (initial mount / project switch, browser back/forward) —
   * never reactively from assessmentParam changing, which is what used to race against
   * commitFloatSession's own writes (router.replace can resolve out of call order) and
   * cause tab switches to silently snap back to a previously-active assessment.
   */
  const reconcileAssessmentFromUrl = useCallback((targetAssessmentId: string) => {
    if (restoringAssessmentRef.current === targetAssessmentId) return;

    const { tabs, activeTabId } = floatSessionRef.current;
    const alreadyOpen = tabs.some(
      (widget) =>
        isAssessmentLinkedFloat(widget)
        && widget.data?.instance_id === targetAssessmentId,
    );
    if (alreadyOpen) {
      restoringAssessmentRef.current = targetAssessmentId;
      const tabId = `assessment:${targetAssessmentId}`;
      if (activeTabId !== tabId) {
        activateFloatTab(tabId);
      }
      return;
    }

    restoringAssessmentRef.current = targetAssessmentId;
    void api.listAssessmentInstances(projectId)
      .then((instances) => {
        const instance = instances.find((item) => item.id === targetAssessmentId);
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
        openFloatTab({
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
        });
      })
      .catch(() => {
        restoringAssessmentRef.current = null;
        replaceWorkbenchSearchParams((params) => {
          params.delete(ASSESSMENT_SEARCH_PARAM);
        });
      });
  }, [activeChatId, activateFloatTab, openFloatTab, panelParam, projectId, replaceWorkbenchSearchParams]);

  // Restore from whatever ?assessment= is in the URL at mount / project switch (hard
  // refresh, deep link). Reads window.location directly rather than the assessmentParam
  // state, since this must fire exactly once per project regardless of later URL writes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const initial = parseAssessmentParam(
      new URLSearchParams(window.location.search).get(ASSESSMENT_SEARCH_PARAM),
    );
    if (initial) {
      reconcileAssessmentFromUrl(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Genuine browser back/forward (never triggered by our own replaceWorkbenchSearchParams
  // calls) — re-sync the active tab from whatever the URL now shows.
  useEffect(() => {
    const onPopState = () => {
      if (typeof window === 'undefined') return;
      restoringAssessmentRef.current = null;
      const current = parseAssessmentParam(
        new URLSearchParams(window.location.search).get(ASSESSMENT_SEARCH_PARAM),
      );
      if (current) {
        reconcileAssessmentFromUrl(current);
      }
      // No ?assessment= after navigating back/forward — tabs persist regardless
      // (browser-tab semantics); nothing to reconcile.
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [reconcileAssessmentFromUrl]);

  /** Guards against re-entrant fetch+open for the same in-flight ?variable= restore. */
  const restoringVariableRef = useRef<string | null>(null);

  /**
   * Restore/activate the Variables floor's selected-variable float from a given
   * ?variable= id. Called ONLY from genuinely external triggers (mount/project switch,
   * browser back/forward) — same reasoning as reconcileAssessmentFromUrl. This used to
   * be a reactive effect keyed on variableParam/panelParam, which meant ANY unrelated
   * commitFloatSession-triggered URL write (e.g. opening/activating an assessment tab
   * while ?variable= was still in the URL) churned activateFloatTab/openFloatTab's
   * identities, re-ran the effect, and forced the variable tab back into focus — you
   * simply couldn't switch away from it while on the Variables floor.
   */
  const reconcileVariableFromUrl = useCallback((targetVariableId: string) => {
    if (restoringVariableRef.current === targetVariableId) return;

    const alreadyOpen = floatSessionRef.current.tabs.some((widget) => {
      if (widget.type !== 'variable_detail') return false;
      const id =
        (typeof widget.data?.variable?.id === 'string' && widget.data.variable.id)
        || (typeof widget.data?.assumption?.id === 'string' && widget.data.assumption.id)
        || null;
      return id === targetVariableId || widget.messageId === `variable-${targetVariableId}`;
    });
    if (alreadyOpen) {
      restoringVariableRef.current = targetVariableId;
      activateFloatTab(`variable:${targetVariableId}`);
      return;
    }

    restoringVariableRef.current = targetVariableId;
    void api.getVariable(targetVariableId)
      .then((variable) => {
        setFloatLayout('docked');
        openFloatTab(floatWidgetForVariable(variable));
      })
      .catch(() => {
        restoringVariableRef.current = null;
        replaceWorkbenchSearchParams((params) => {
          params.delete(VARIABLE_SEARCH_PARAM);
        });
      });
  }, [activateFloatTab, openFloatTab, replaceWorkbenchSearchParams]);

  // Restore from whatever ?panel=variables&variable= is in the URL at mount / project
  // switch (hard refresh, deep link).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const initialPanel = parseContextPanelParam(params.get(CONTEXT_PANEL_SEARCH_PARAM));
    const initialVariable = parseVariableParam(params.get(VARIABLE_SEARCH_PARAM));
    if (initialPanel === 'variables' && initialVariable) {
      reconcileVariableFromUrl(initialVariable);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Genuine browser back/forward.
  useEffect(() => {
    const onPopState = () => {
      if (typeof window === 'undefined') return;
      restoringVariableRef.current = null;
      const params = new URLSearchParams(window.location.search);
      const currentPanel = parseContextPanelParam(params.get(CONTEXT_PANEL_SEARCH_PARAM));
      const currentVariable = parseVariableParam(params.get(VARIABLE_SEARCH_PARAM));
      if (currentPanel === 'variables' && currentVariable) {
        reconcileVariableFromUrl(currentVariable);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [reconcileVariableFromUrl]);

  // A FloorLayer overlay stays up when a companion float docks beside it.
  // The mini launcher stack only shows when no float or expanded floor owns the stage.
  // During onboarding (no framework confirmed yet) treat this as a plain active thread —
  // no context rail/mini floats until the project graduates out of onboarding.
  const showContextStack = Boolean(projectId)
    && !isOnboarding
    && (expandedContextWidget != null || (!showFloatLayer && (!hasMessages || panelParam != null)));
  // Companion side panels promote a docked float to full-stage, covering the floor;
  // side nav lives outside this workbench and is unaffected.
  // Companion columns and the Full screen control both grow the docked float via
  // measured width so docked ↔ full can animate (true `solo` layout uses insets and jumps).
  const floatLayoutSolo = showFloatLayer && floatLayout === 'solo';
  const companionExpanded = showFloatLayer && floatCompanionOpen && !floatLayoutSolo;
  const stageExpanded = showFloatLayer && floatStageExpanded && !floatLayoutSolo;
  const floatIsSolo = floatLayoutSolo || companionExpanded || stageExpanded;
  const floatIsDocked = showFloatLayer && !floatIsSolo;
  const floatFullWidthPx = workbenchWidthPx > 0
    ? Math.max(floatPanelWidthPx, workbenchWidthPx - RIGHT_MARGIN_PX)
    : floatPanelWidthPx;
  const floatDisplayWidthPx = (companionExpanded || stageExpanded) ? floatFullWidthPx : floatPanelWidthPx;
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
  // A docked float's card top must line up with whatever it's sitting beside: a
  // FloorLayer overlay (Overview/Variables/Files/Assessments) is inset-y-3, so the
  // float mirrors that 0.75rem top gap; Chat itself renders flush with no inset, so
  // the float sits flush too — otherwise the tab bar height pushes the card's top
  // edge below the floor header's divider (or, without the tab bar, above it).
  const floatDockedTopInset = expandedContextWidget != null ? '0.75rem' : '0px';

  useLayoutEffect(() => {
    const el = workbenchRef.current;
    if (!el) return;
    const update = () => setWorkbenchWidthPx(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // rAF-batched so a burst of native mousemove events (which can fire far faster
  // than the browser paints) collapses into one width commit per frame.
  const floatResizeFrameRef = useRef<number | null>(null);
  const floatResizePendingClientXRef = useRef<number | null>(null);
  /** True while dragging inward from fullscreen — skip the >60% re-promote until below the band. */
  const floatResizeCollapsingRef = useRef(false);

  const handleFloatResizeMove = useCallback((event: MouseEvent) => {
    floatResizePendingClientXRef.current = event.clientX;
    if (floatResizeFrameRef.current != null) return;
    floatResizeFrameRef.current = requestAnimationFrame(() => {
      floatResizeFrameRef.current = null;
      const clientX = floatResizePendingClientXRef.current;
      if (clientX == null) return;
      const workbenchEl = workbenchRef.current;
      const contentWidth = workbenchWidthPx > 0
        ? workbenchWidthPx
        : (workbenchEl?.clientWidth ?? window.innerWidth);
      const workbenchRight = workbenchEl?.getBoundingClientRect().right ?? window.innerWidth;
      const nextWidth = workbenchRight - clientX - RIGHT_MARGIN_PX;
      const maxDockedWidth = Math.floor(contentWidth * CHAT_EDITOR_PANEL_MAX_CONTENT_RATIO);
      const fullWidth = Math.max(maxDockedWidth, contentWidth - RIGHT_MARGIN_PX);

      // Collapsing from fullscreen: allow widths above the docked max so the panel
      // can shrink continuously. Re-promote only after the gesture re-enters expand.
      if (floatResizeCollapsingRef.current) {
        const minWidth = clampChatEditorPanelWidth(0, {
          contentWidth,
          companionOpen: floatCompanionOpen,
        });
        const width = Math.min(fullWidth, Math.max(minWidth, Math.round(nextWidth)));
        setFloatStageExpanded(false);
        setFloatPanelWidthPx(width);
        if (width <= maxDockedWidth) {
          floatResizeCollapsingRef.current = false;
        }
        return;
      }

      // Expanding past 60% of the stage → promote to fullscreen.
      if (!floatCompanionOpen && nextWidth > maxDockedWidth) {
        setFloatPanelWidthPx(clampChatEditorPanelWidth(maxDockedWidth, {
          contentWidth,
          companionOpen: false,
        }));
        setFloatStageExpanded(true);
        setIsResizingFloatPanel(false);
        return;
      }

      setFloatStageExpanded(false);
      setFloatPanelWidthPx(clampChatEditorPanelWidth(nextWidth, {
        contentWidth,
        companionOpen: floatCompanionOpen,
      }));
    });
  }, [floatCompanionOpen, workbenchWidthPx]);

  const handleFloatResizeEnd = useCallback(() => {
    if (floatResizeFrameRef.current != null) {
      cancelAnimationFrame(floatResizeFrameRef.current);
      floatResizeFrameRef.current = null;
    }
    if (floatResizeCollapsingRef.current) {
      // Gesture ended still above the docked band — settle at max docked split.
      const contentWidth = workbenchWidthPx > 0
        ? workbenchWidthPx
        : (workbenchRef.current?.clientWidth ?? window.innerWidth);
      setFloatPanelWidthPx(clampChatEditorPanelWidth(contentWidth, {
        contentWidth,
        companionOpen: floatCompanionOpen,
      }));
      floatResizeCollapsingRef.current = false;
    }
    setIsResizingFloatPanel(false);
  }, [floatCompanionOpen, workbenchWidthPx]);

  /** Start a resize; if fullscreen, hand off to measured docked width first so drag can collapse. */
  const handleFloatResizeStart = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    if (floatLayout === 'solo' || floatStageExpanded) {
      const fullWidth = workbenchWidthPx > 0
        ? Math.max(floatPanelWidthPx, workbenchWidthPx - RIGHT_MARGIN_PX)
        : floatPanelWidthPx;
      if (floatLayout === 'solo') {
        setFloatLayout('docked');
      }
      setFloatStageExpanded(false);
      setFloatPanelWidthPx(fullWidth);
      floatResizeCollapsingRef.current = true;
    } else {
      floatResizeCollapsingRef.current = false;
    }
    setIsResizingFloatPanel(true);
  }, [floatLayout, floatPanelWidthPx, floatStageExpanded, workbenchWidthPx]);

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

  // Keep a persisted width inside the current stage's 60% docked band.
  useEffect(() => {
    if (workbenchWidthPx <= 0 || isResizingFloatPanel) return;
    setFloatPanelWidthPx((prev) => {
      const next = clampChatEditorPanelWidth(prev, {
        contentWidth: workbenchWidthPx,
        companionOpen: floatCompanionOpen,
      });
      return next === prev ? prev : next;
    });
  }, [floatCompanionOpen, isResizingFloatPanel, workbenchWidthPx]);

  const cleanupActiveEphemeralAssessment = useCallback((widgets: FloatWidget[]) => {
    for (const widget of widgets) {
      cleanupEphemeralForWidget(widget, projectId, ephemeralAssessmentSessionsRef.current);
    }
  }, [projectId]);

  const handleCloseFloatTab = useCallback((tabId: string) => {
    const { tabs, activeTabId, recentOrder } = floatSessionRef.current;
    const result = closeFloatTabInSession(tabs, activeTabId, tabId);
    if (!result.closed) return;

    cleanupEphemeralForWidget(result.closed, projectId, ephemeralAssessmentSessionsRef.current);

    // commitFloatSession derives ?assessment= from the resulting active tab, so no
    // separate assessment-link bookkeeping is needed here — only the variable URL
    // param (which isn't tab-active-derived) needs an explicit check.
    const closingVariableDetail = result.closed.type === 'variable_detail';
    if (closingVariableDetail && variableParam) {
      const stillHasVariable = result.tabs.some((tab) => tab.type === 'variable_detail');
      if (!stillHasVariable) {
        replaceWorkbenchSearchParams((params) => {
          params.delete(VARIABLE_SEARCH_PARAM);
        });
      }
    }

    if (result.tabs.length === 0) {
      commitFloatSession([], null, []);
      setFloatLayerHidden(false);
      setFloatLayout('docked');
      setFloatCompanionOpen(false);
      setFloatStageExpanded(false);
      if (!activeChatId && !expandedContextWidget) {
        setHasMessages(false);
      }
      return;
    }

    commitFloatSession(
      result.tabs,
      result.activeTabId,
      recentOrder.filter((id) => id !== tabId),
    );
  }, [
    activeChatId,
    commitFloatSession,
    expandedContextWidget,
    projectId,
    replaceWorkbenchSearchParams,
    variableParam,
  ]);

  /** Hide the float window; keep tabs so a later open can restore the session (browser minimize). */
  const handleHideFloatLayer = useCallback(() => {
    if (floatSessionRef.current.tabs.length === 0) return;
    setLastFloatSession({
      tabs: floatSessionRef.current.tabs,
      activeTabId: floatSessionRef.current.activeTabId,
    });
    setFloatLayerHidden(true);
    setFloatCompanionOpen(false);
    setFloatStageExpanded(false);
  }, []);

  /** Discard the entire float session (landing reset / tour / last-tab close). */
  const handleCloseFloatLayer = useCallback(() => {
    const { tabs } = floatSessionRef.current;
    cleanupActiveEphemeralAssessment(tabs);
    const closingVariableDetail = tabs.some((widget) => widget.type === 'variable_detail');
    commitFloatSession([], null, []);
    setFloatLayerHidden(false);
    setFloatLayout('docked');
    setFloatCompanionOpen(false);
    setFloatStageExpanded(false);
    if (closingVariableDetail && variableParam) {
      replaceWorkbenchSearchParams((params) => {
        params.delete(VARIABLE_SEARCH_PARAM);
      });
    }
    if (!activeChatId && !expandedContextWidget) {
      setHasMessages(false);
    }
  }, [
    activeChatId,
    cleanupActiveEphemeralAssessment,
    commitFloatSession,
    expandedContextWidget,
    replaceWorkbenchSearchParams,
    variableParam,
  ]);

  const handleAssessmentEngaged = useCallback((instanceId: string) => {
    const session = ephemeralAssessmentSessionsRef.current.get(instanceId);
    if (session) {
      session.engaged = true;
    }
  }, []);

  const resolveFloatLayoutForOpen = useCallback((): FloatLayout => {
    // Dock beside whichever floor is already active — an overlay FloorLayer
    // (Variables/Files/Overview/Assessments), or Chat (messages on stage). Only a bare
    // landing with no floor content yet opens the float solo.
    if (expandedContextWidget != null || hasMessages) return 'docked';
    return 'solo';
  }, [expandedContextWidget, hasMessages]);

  const prepareFloatLayoutForOpen = useCallback((layout: FloatLayout) => {
    if (layout === 'solo') {
      setExpandedContextWidget(null);
      setExpandMotionMode('stack');
      chatShell?.setActiveContextWidget(null);
      dismissContextPanelParam();
      setHasMessages(true);
    }
    setFloatLayout(layout);
    setFloatCompanionOpen(false);
    setFloatStageExpanded(false);
    setFloatLayerHidden(false);
  }, [chatShell, dismissContextPanelParam]);

  /** Chat artifact: open/focus a single new widget without wiping the session. */
  const handleOpenFloatWidget = useCallback((widget: FloatWidget) => {
    prepareFloatLayoutForOpen(resolveFloatLayoutForOpen());
    openFloatTab(widget);
  }, [openFloatTab, prepareFloatLayoutForOpen, resolveFloatLayoutForOpen]);

  const openPinnedFloat = useCallback((widgets: FloatWidget[], layout: FloatLayout) => {
    const primary = widgets[widgets.length - 1];
    if (!primary) return;

    prepareFloatLayoutForOpen(layout);
    // Opening a batch (e.g. reopen last session) restores each tab, activating the last.
    // ?assessment= sync for the resulting active tab happens inside commitFloatSession.
    if (widgets.length === 1) {
      openFloatTab(primary);
      return;
    }
    let tabs: FloatWidget[] = [];
    let activeTabId: string | null = null;
    let recentOrder: string[] = [];
    for (const widget of widgets) {
      const result = openFloatTabInSession(tabs, activeTabId, widget, recentOrder);
      if (result.evicted) {
        cleanupEphemeralForWidget(result.evicted, projectId, ephemeralAssessmentSessionsRef.current);
        recentOrder = recentOrder.filter((id) => floatTabDedupeKey(result.evicted!) !== id);
      }
      tabs = result.tabs;
      activeTabId = result.activeTabId;
      recentOrder = touchFloatTabRecentOrder(recentOrder, result.activeTabId);
    }
    commitFloatSession(tabs, activeTabId, recentOrder);
  }, [commitFloatSession, openFloatTab, prepareFloatLayoutForOpen, projectId]);

  /** Open Variables floor (if needed) and dock the selected variable as a float tab. */
  const handleOpenVariableDetail = useCallback((variable: Variable) => {
    setExpandedContextWidget('variables');
    setExpandMotionMode('stack');
    chatShell?.setActiveContextWidget('variables');
    setFloatLayout('docked');
    setFloatCompanionOpen(false);
    setFloatStageExpanded(false);
    // Making the variable tab active clears any stale ?assessment= via commitFloatSession.
    openFloatTab(floatWidgetForVariable(variable));
    replaceWorkbenchSearchParams((params) => {
      params.delete('chat');
      params.set(CONTEXT_PANEL_SEARCH_PARAM, 'variables');
      params.set(VARIABLE_SEARCH_PARAM, variable.id);
    });
  }, [chatShell, openFloatTab, replaceWorkbenchSearchParams]);

  const handleOpenDecisionLog = useCallback((context: AssessmentLogContext) => {
    replaceActiveFloatTab({
      type: 'decision_log',
      data: {
        instance_id: context.instanceId,
        assessment_id: context.assessmentId,
        title: `[History] ${context.title}`,
      },
      messageId: `decision-log-${context.instanceId}`,
    });
  }, [replaceActiveFloatTab]);

  const handleOpenActivityLog = useCallback((context: AssessmentLogContext) => {
    replaceActiveFloatTab({
      type: 'activity_log',
      data: {
        instance_id: context.instanceId,
        assessment_id: context.assessmentId,
        title: context.title,
      },
      messageId: `activity-log-${context.instanceId}`,
    });
  }, [replaceActiveFloatTab]);

  const handleReopenAssessmentFromLog = useCallback((context: AssessmentLogContext) => {
    replaceActiveFloatTab({
      type: 'assessment_workspace',
      data: {
        instance_id: context.instanceId,
        assessment_id: context.assessmentId,
        title: context.title,
      },
      messageId: `workspace-${context.instanceId}`,
    });
  }, [replaceActiveFloatTab]);

  const handleOpenAssessmentReport = useCallback((payload: {
    instanceId: string;
    assessmentId: string;
    title: string;
    material: ProjectMaterial;
  }) => {
    replaceActiveFloatTab(floatWidgetForAssessmentReport(payload));
  }, [replaceActiveFloatTab]);

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
    setFloatTabs((prev) => syncWidgetTitles(prev));
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

    if (floatSessionRef.current.tabs.length) {
      // clearFloatSession clears ?assessment= via commitFloatSession's own sync.
      clearFloatSession();
      setFloatLayout('docked');
      setFloatCompanionOpen(false);
      setFloatStageExpanded(false);
      didReset = true;
    }

    if (didReset && !activeChatId) {
      setHasMessages(false);
    }

    return didReset;
  }, [
    activeChatId,
    chatShell,
    clearFloatSession,
    expandedContextWidget,
    panelParam,
    dismissContextPanelParam,
  ]);

  useChatShellLandingReset(resetLandingOverlays);

  const handleExpandedContextWidgetChange = useCallback((
    widget: ChatContextExpandedWidget | null,
    options?: ExpandedWidgetChangeOptions,
  ) => {
    const motion = options?.motion ?? (widget ? 'stack' : undefined);

    // Floor changes no longer wipe the whole float session. Variable detail tabs
    // are removed when leaving the Variables floor (URL / panel effect).

    if (widget && motion === 'stack') {
      setExpandMotionMode('stack');
    } else if (widget) {
      setExpandMotionMode('center');
    } else {
      setExpandMotionMode('stack');
    }

    setExpandedContextWidget(widget);
    chatShell?.setActiveContextWidget(widget);
    setFloatLayout('docked');
    setFloatCompanionOpen(false);
    setFloatStageExpanded(false);

    if (widget) {
      // Persist floor in the URL for refresh / deep-link (stack and sidebar).
      replaceWorkbenchSearchParams((params) => {
        params.delete('chat');
        params.delete(VARIABLE_SEARCH_PARAM);
        params.set(CONTEXT_PANEL_SEARCH_PARAM, widget);
      });
      return;
    }

    if (searchParams.get(CONTEXT_PANEL_SEARCH_PARAM)) {
      dismissContextPanelParam();
    }
  }, [
    chatShell,
    dismissContextPanelParam,
    replaceWorkbenchSearchParams,
    searchParams,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const bumpRefresh = () => setContextRefreshKey((k) => k + 1);
    window.addEventListener('nitrogen:variable-updated', bumpRefresh);
    window.addEventListener('nitrogen:variable-deleted', bumpRefresh);
    window.addEventListener('nitrogen:project-signals-updated', bumpRefresh);
    return () => {
      window.removeEventListener('nitrogen:variable-updated', bumpRefresh);
      window.removeEventListener('nitrogen:variable-deleted', bumpRefresh);
      window.removeEventListener('nitrogen:project-signals-updated', bumpRefresh);
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
      clearFloatSession();
      setFloatLayout('docked');
      setFloatCompanionOpen(false);
      setFloatStageExpanded(false);
    };
    window.addEventListener('nitrogen:tour-replay', onReplay);
    return () => window.removeEventListener('nitrogen:tour-replay', onReplay);
  }, [chatShell, clearFloatSession, dismissContextPanelParam]);

  /**
   * Reveal the chat floor beside the float (dock solo / collapse companion / dismiss panel).
   * Chat destination is left alone — callers decide thread vs landing.
   */
  const revealChatFloorFromFloat = useCallback(() => {
    if (expandedContextWidget || panelParam) {
      setExpandedContextWidget(null);
      setExpandMotionMode('stack');
      chatShell?.setActiveContextWidget(null);
      dismissContextPanelParam();
    }
    // True solo uses inset chrome (no width). Hand off to the measured full-width
    // path first so collapsing can animate width down to the docked size.
    if (floatLayout === 'solo') {
      setFloatLayout('docked');
      setFloatCompanionOpen(false);
      setFloatStageExpanded(true);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setFloatStageExpanded(false);
        });
      });
      return;
    }
    setFloatCompanionOpen(false);
    setFloatStageExpanded(false);
  }, [chatShell, dismissContextPanelParam, expandedContextWidget, floatLayout, panelParam]);

  /** Expand a docked float across the stage via width animation (keeps floatLayout docked). */
  const expandFloatToStage = useCallback(() => {
    setFloatStageExpanded(true);
  }, []);

  /** Reopen a hidden float session from a floor-only stage. */
  const handleOpenEditorFromFloor = useCallback(() => {
    const existing = floatSessionRef.current.tabs;
    if (existing.length > 0) {
      prepareFloatLayoutForOpen(resolveFloatLayoutForOpen());
      setFloatLayerHidden(false);
      return;
    }
    if (!lastFloatSession?.tabs.length) return;
    openPinnedFloat(lastFloatSession.tabs, resolveFloatLayoutForOpen());
    if (lastFloatSession.activeTabId) {
      activateFloatTab(lastFloatSession.activeTabId);
    }
  }, [
    activateFloatTab,
    lastFloatSession,
    openPinnedFloat,
    prepareFloatLayoutForOpen,
    resolveFloatLayoutForOpen,
  ]);
  const handleOpenChatFromFloat = useCallback(() => {
    revealChatFloorFromFloat();

    if (activeChatId) {
      setHasMessages(true);
      return;
    }

    const instanceId = urlAssessmentInstanceId;
    if (!instanceId || !projectId) return;

    const openAssociatedChat = (chatId: string) => {
      replaceWorkbenchSearchParams((params) => {
        params.delete(CONTEXT_PANEL_SEARCH_PARAM);
        params.set('chat', chatId);
      });
      setHasMessages(true);
    };

    const cachedChatId = frameworkAssessmentInstances.find((item) => item.id === instanceId)?.chat_id;
    if (cachedChatId) {
      openAssociatedChat(cachedChatId);
      return;
    }

    void api.listAssessmentInstances(projectId)
      .then((instances) => {
        const chatId = instances.find((item) => item.id === instanceId)?.chat_id;
        if (chatId) openAssociatedChat(chatId);
      })
      .catch(() => {
        // Leave landing; association lookup is best-effort.
      });
  }, [
    activeChatId,
    frameworkAssessmentInstances,
    projectId,
    replaceWorkbenchSearchParams,
    revealChatFloorFromFloat,
    urlAssessmentInstanceId,
  ]);

  /** Make Chat the active floor beside any open assessment float (Investigate entry). */
  const revealChatFloorForInvestigate = useCallback(() => {
    revealChatFloorFromFloat();
    setHasMessages(true);
  }, [revealChatFloorFromFloat]);

  // Investigate from assessment inputs: reveal the chat floor and drop a draft (with field
  // context) into the composer for the user to review and send themselves - never auto-sent.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const queueInvestigateDraft = (detail: {
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
      setPendingInvestigateDraft({
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
      queueInvestigateDraft({
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
      // Only claim investigate drafts that carry field context (routed through the
      // pendingDraft prop below so they survive the chat floor/tab mounting). Plain
      // drafts without field context still flow straight to ConversationView.
      if (!detail?.fieldContext?.field_name || !detail.text) return;
      if (detail._workspaceForwarded || detail._investigateAutoSend) return;
      detail._investigateAutoSend = true;
      queueInvestigateDraft({
        text: detail.text,
        toolHint: detail.toolHint,
        fieldContext: detail.fieldContext,
        modelInputsContext: detail.modelInputsContext ?? null,
        variableId: detail.fieldContext.variable_id ?? null,
      });
    };

    window.addEventListener('nitrogen:open-variable-chat', onOpenVariableChat);
    // Capture so we claim investigate drafts before ConversationView's own listener
    // would otherwise fill the composer directly from the raw window event.
    window.addEventListener('nitrogen:draft', onDraft, true);
    return () => {
      window.removeEventListener('nitrogen:open-variable-chat', onOpenVariableChat);
      window.removeEventListener('nitrogen:draft', onDraft, true);
    };
  }, [revealChatFloorForInvestigate]);

  const chatSurfaceKey = projectId;

  return (
    <div ref={workbenchRef} className="relative flex-1 flex flex-col min-h-0 min-w-0 h-full bg-surface">
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
            autoSendOnMount={seedParam}
            onAutoSendOnMountHandled={handleSeedHandled}
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
            onOpenFloatWidget={handleOpenFloatWidget}
            activeAssessmentContext={activeAssessmentContext}
            activeEditorContext={activeEditorContext}
            focusedVariableId={focusedVariableId}
            pendingAutoSend={pendingInvestigateDraft}
            onPendingAutoSendHandled={() => setPendingInvestigateDraft(null)}
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

      {/* Landing uses the mini context stack instead of Open Editor. */}
      {!showFloatLayer
        && lastFloatSession
        && lastFloatSession.tabs.length > 0
        && (hasMessages || Boolean(activeChatId) || expandedContextWidget != null) ? (
        <div
          className="absolute bottom-4 z-30 transition-[right] duration-300 ease-in-out"
          style={{
            // Sit in the floor stage; clear the mini context stack when it owns the right rail.
            right: showContextStack && !expandedContextWidget
              ? CHAT_CONTEXT_STACK_GUTTER
              : '1rem',
          }}
        >
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 rounded-md border border-stroke-subtle bg-white px-2.5 text-[11px] font-medium leading-none text-text-secondary shadow-floating-panel transition-colors hover:bg-black/[0.04] hover:text-text-primary"
            onClick={handleOpenEditorFromFloor}
            aria-label="Open Editor"
          >
            <PanelRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Open Editor
          </button>
        </div>
      ) : null}

      {showContextStack && (
        <ChatContextStack
          project={selectedProject}
          projectId={projectId}
          refreshKey={contextRefreshKey}
          expandedWidget={expandedContextWidget}
          expandMotionMode={expandMotionMode}
          onExpandedWidgetChange={handleExpandedContextWidgetChange}
          onOpenVariableDetail={handleOpenVariableDetail}
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
            floatLayoutSolo
              ? SOLO_FLOAT_STACK_CLASS
              : `${FLOATING_STACK_CLASS} ${(companionExpanded || stageExpanded) ? 'z-30' : 'z-20'} ${isResizingFloatPanel ? '' : 'transition-[width,top] duration-300 ease-in-out'}`
          }
          style={floatLayoutSolo ? undefined : { width: floatDisplayWidthPx, top: floatDockedTopInset }}
        >
          <FloatTabBar
            tabs={floatTabs}
            activeTabId={activeFloatTabId}
            onActivate={activateFloatTab}
            onClose={handleCloseFloatTab}
          />
          <div className={`relative ${FLOAT_CARD_CLASS}`}>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize float panel"
              onMouseDown={handleFloatResizeStart}
              className="absolute left-0 top-0 bottom-0 z-10 w-2 cursor-col-resize group"
            >
              <div
                className={`absolute left-0 top-0 h-full w-px transition-colors ${isResizingFloatPanel ? 'bg-accent/60' : 'bg-divider group-hover:bg-accent/40'}`}
              />
            </div>
            <FloatLayer
              widgets={floatTabs}
              activeTabId={activeFloatTabId}
              keepAliveTabIds={floatKeepAliveTabIds}
              projectId={projectId}
              onClose={handleHideFloatLayer}
              onAssessmentEngaged={handleAssessmentEngaged}
              onOpenDecisionLog={handleOpenDecisionLog}
              onOpenActivityLog={handleOpenActivityLog}
              onOpenAssessmentReport={handleOpenAssessmentReport}
              onOpenAssessment={handleReopenAssessmentFromLog}
              onAssessmentTitleChange={handleAssessmentTitleChange}
              onCompanionSidePanelOpenChange={setFloatCompanionOpen}
              onOpenDocument={handleOpenDocument}
              onOpenFile={handleOpenProjectFile}
            />
            <div className="absolute bottom-4 left-4 z-40">
              {floatIsSolo ? (
                <button
                  type="button"
                  className="flex h-8 items-center gap-1.5 rounded-md border border-stroke-subtle bg-white px-2.5 text-[11px] font-medium leading-none text-text-secondary shadow-floating-panel transition-colors hover:bg-black/[0.04] hover:text-text-primary"
                  onClick={handleOpenChatFromFloat}
                  aria-label="Open Chat"
                >
                  <MessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Open Chat
                </button>
              ) : (
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-stroke-subtle bg-white text-text-secondary shadow-floating-panel transition-colors hover:bg-black/[0.04] hover:text-text-primary"
                  onClick={expandFloatToStage}
                  aria-label="Full screen"
                  title="Full screen"
                >
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
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

