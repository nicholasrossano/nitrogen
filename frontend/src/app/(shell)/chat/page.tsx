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
import { EditorSidePanel, type EditorWidget } from '@/components/editor/EditorSidePanel';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import {
  editorWidgetForCitation,
  editorWidgetForProjectMaterial,
} from '@/lib/openProjectFileInEditor';
import { api, type Project, type ProjectMaterial } from '@/lib/api';
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
const RIGHT_MARGIN_PX = 12;

function ChatWorkbenchContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const chatShell = useChatShell();
  const { activeWorkspace, loadWorkspaces } = useWorkspaceStore();

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [hasMessages, setHasMessages] = useState(false);
  const [editorWidgets, setEditorWidgets] = useState<EditorWidget[]>([]);
  const [pinnedEditorWidgets, setPinnedEditorWidgets] = useState<EditorWidget[] | null>(null);
  const [contextRefreshKey, setContextRefreshKey] = useState(0);
  const [expandedContextWidget, setExpandedContextWidget] = useState<ChatContextExpandedWidget | null>(null);
  const [expandMotionMode, setExpandMotionMode] = useState<ContextPanelExpandMotion>('stack');
  const [variablesFocusId, setVariablesFocusId] = useState<string | null>(null);
  const [editorPanelWidthPx, setEditorPanelWidthPx] = useState(readChatEditorPanelWidth);
  const [isResizingEditorPanel, setIsResizingEditorPanel] = useState(false);
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
    setPinnedEditorWidgets(null);
    setEditorWidgets([]);
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

    setPinnedEditorWidgets(null);
    setEditorWidgets([]);
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

  const effectiveEditorWidgets = pinnedEditorWidgets ?? editorWidgets;
  const showContextStack = Boolean(effectiveProjectId) && (!hasMessages || panelParam != null || expandedContextWidget != null);
  const showEditorPanel = effectiveEditorWidgets.length > 0;
  const reserveRightSpace = (showContextStack && !expandedContextWidget) || showEditorPanel;
  const rightGutter = showEditorPanel
    ? chatEditorPanelGutter(editorPanelWidthPx)
    : reserveRightSpace
      ? CHAT_CONTEXT_STACK_GUTTER
      : undefined;

  const handleEditorResizeMove = useCallback((event: MouseEvent) => {
    const nextWidth = window.innerWidth - event.clientX - RIGHT_MARGIN_PX;
    setEditorPanelWidthPx(clampChatEditorPanelWidth(nextWidth));
  }, []);

  const handleEditorResizeEnd = useCallback(() => {
    setIsResizingEditorPanel(false);
  }, []);

  useEffect(() => {
    if (!isResizingEditorPanel) return;
    document.addEventListener('mousemove', handleEditorResizeMove);
    document.addEventListener('mouseup', handleEditorResizeEnd);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', handleEditorResizeMove);
      document.removeEventListener('mouseup', handleEditorResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [handleEditorResizeEnd, handleEditorResizeMove, isResizingEditorPanel]);

  useEffect(() => {
    if (isResizingEditorPanel) return;
    writeChatEditorPanelWidth(editorPanelWidthPx);
  }, [editorPanelWidthPx, isResizingEditorPanel]);

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

  const cleanupActiveEphemeralAssessment = useCallback((widgets: EditorWidget[]) => {
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

  const handleCloseEditorPanel = useCallback(() => {
    cleanupActiveEphemeralAssessment(pinnedEditorWidgets ?? editorWidgets);
    setPinnedEditorWidgets(null);
    setEditorWidgets([]);
    if (!activeChatId) {
      setHasMessages(false);
    }
  }, [activeChatId, cleanupActiveEphemeralAssessment, editorWidgets, pinnedEditorWidgets]);

  const handleAssessmentEngaged = useCallback((instanceId: string) => {
    const session = ephemeralAssessmentSessionsRef.current.get(instanceId);
    if (session) {
      session.engaged = true;
    }
  }, []);

  const handleEditorWidgetsChange = useCallback((widgets: EditorWidget[]) => {
    setEditorWidgets(widgets);
    if (widgets.length > 0) setPinnedEditorWidgets(null);
  }, []);

  const handleOpenDocument = useCallback((citation: ResearchPanelCitation) => {
    setExpandedContextWidget(null);
    setVariablesFocusId(null);
    clearContextPanelParam();
    setHasMessages(true);
    setPinnedEditorWidgets([editorWidgetForCitation(citation)]);
  }, [clearContextPanelParam]);

  const handleOpenWorkspaceAssessment = useCallback(
    (assessment: {
      instanceId: string;
      assessmentId: string;
      title?: string | null;
      pendingEngagement?: boolean;
    }) => {
      setExpandedContextWidget(null);
      setVariablesFocusId(null);
      clearContextPanelParam();
      setHasMessages(true);
      if (assessment.pendingEngagement && effectiveProjectId) {
        ephemeralAssessmentSessionsRef.current.set(assessment.instanceId, {
          projectId: effectiveProjectId,
          engaged: false,
        });
      }
      setPinnedEditorWidgets([
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
      ]);
    },
    [clearContextPanelParam, effectiveProjectId],
  );

  const handleOpenProjectFile = useCallback((file: ProjectMaterial) => {
    setExpandedContextWidget(null);
    setVariablesFocusId(null);
    clearContextPanelParam();
    setHasMessages(true);
    setPinnedEditorWidgets([editorWidgetForProjectMaterial(file)]);
  }, [clearContextPanelParam]);

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

    if (pinnedEditorWidgets?.length || editorWidgets.length) {
      cleanupActiveEphemeralAssessment(pinnedEditorWidgets ?? editorWidgets);
      setPinnedEditorWidgets(null);
      setEditorWidgets([]);
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
    editorWidgets.length,
    expandedContextWidget,
    panelParam,
    pinnedEditorWidgets,
  ]);

  useChatShellLandingReset(resetLandingOverlays);

  const handleExpandedContextWidgetChange = useCallback((
    widget: ChatContextExpandedWidget | null,
    options?: ExpandedWidgetChangeOptions,
  ) => {
    const motion = options?.motion ?? (widget ? 'stack' : undefined);

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
  }, [chatShell, clearContextPanelParam, effectiveProjectId, replaceChatSearchParams, searchParams]);

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
        className={`flex-1 flex flex-col min-h-0 min-w-0 ${isResizingEditorPanel ? '' : 'transition-[padding-right] duration-300 ease-in-out'}`}
        style={{ paddingRight: rightGutter }}
      >
        <div
          className={`flex-1 min-h-0 ${contextStackTransitionClass} ${contextStackBackdropMotionClass(Boolean(expandedContextWidget), expandMotionMode)}`}
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
              landingComposerTitle={isOnboarding ? undefined : selectedProject?.name}
              landingHeaderContent={<></>}
              onLandingStateChange={(onLanding) => {
                if (wasOnLandingRef.current && !onLanding && panelParam) {
                  clearContextPanelParam();
                } else if (panelParam && !activeChatId) {
                  setHasMessages(false);
                } else if (!panelParam) {
                  setHasMessages(!onLanding);
                }
                wasOnLandingRef.current = onLanding;
              }}
              onEditorWidgetsChange={handleEditorWidgetsChange}
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
          onOpenWorkspaceAssessment={handleOpenWorkspaceAssessment}
        />
      )}

      {showEditorPanel && effectiveProjectId && (
        <aside
          className={`${FLOATING_PANEL_CLASS} top-3 bottom-3 ${isResizingEditorPanel ? '' : 'transition-[width] duration-300 ease-in-out'}`}
          style={{ width: editorPanelWidthPx }}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize editor panel"
            onMouseDown={(event) => {
              event.preventDefault();
              setIsResizingEditorPanel(true);
            }}
            className={`absolute left-0 top-0 bottom-0 z-10 w-2 -translate-x-1/2 cursor-col-resize group ${isResizingEditorPanel ? 'bg-accent/10' : ''}`}
          >
            <div
              className={`absolute left-1/2 top-0 h-full w-px -translate-x-1/2 transition-colors ${isResizingEditorPanel ? 'bg-accent/60' : 'bg-divider group-hover:bg-accent/40'}`}
            />
          </div>
          <EditorSidePanel
            widgets={effectiveEditorWidgets}
            projectId={effectiveProjectId}
            onClose={handleCloseEditorPanel}
            onAssessmentEngaged={handleAssessmentEngaged}
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
