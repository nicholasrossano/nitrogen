'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ProjectChatSurface } from '@/components/core-chat/ProjectChatSurface';
import { PersonalChatSurface } from '@/components/chat-shell/PersonalChatSurface';
import { useChatShell } from '@/components/chat-shell/ChatShellContext';
import { ChangeProjectSelect, resolveDefaultProjectId } from '@/components/chat-shell/ChangeProjectSelect';
import { readLastProjectId, writeLastProjectId, useChatShellLandingReset } from '@/components/chat-shell/ChatShellProvider';
import { ProjectContextPanel } from '@/components/chat-shell/ProjectContextPanel';
import { ProjectAssumptionsPanel } from '@/components/chat-shell/ProjectAssumptionsPanel';
import { ProjectFilesPanel } from '@/components/chat-shell/ProjectFilesPanel';
import { AssumptionsWorkspaceTab } from '@/components/assumptions/AssumptionsWorkspaceTab';
import { AssumptionsChatPanel } from '@/components/assumptions/AssumptionsChatPanel';
import { EditorSidePanel, type EditorWidget } from '@/components/editor/EditorSidePanel';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import {
  editorWidgetForCitation,
  editorWidgetForProjectMaterial,
} from '@/lib/openProjectFileInEditor';
import { api, type Assumption, type Project, type ProjectMaterial } from '@/lib/api';
import { useInitiativeStore } from '@/stores/initiativeStore';
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
  const searchParams = useSearchParams();
  const chatShell = useChatShell();
  const { activeWorkspace, loadWorkspaces } = useWorkspaceStore();

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [hasMessages, setHasMessages] = useState(false);
  const [editorWidgets, setEditorWidgets] = useState<EditorWidget[]>([]);
  const [pinnedEditorWidgets, setPinnedEditorWidgets] = useState<EditorWidget[] | null>(null);
  const [contextRefreshKey, setContextRefreshKey] = useState(0);
  const [assumptionsWorkspaceOpen, setAssumptionsWorkspaceOpen] = useState(false);
  const [focusedAssumptionId, setFocusedAssumptionId] = useState<string | null>(null);
  const [assumptionsCreateNew, setAssumptionsCreateNew] = useState(false);
  const [editorPanelWidthPx, setEditorPanelWidthPx] = useState(readChatEditorPanelWidth);
  const [isResizingEditorPanel, setIsResizingEditorPanel] = useState(false);

  const selectedProjectId = searchParams.get('project');
  const activeChatId = searchParams.get('chat');

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
  }, [activeWorkspace?.id]);

  const effectiveProjectId = useMemo(() => {
    if (selectedProjectId && projects.some((project) => project.id === selectedProjectId)) {
      return selectedProjectId;
    }
    if (projects.length === 0) return null;
    return resolveDefaultProjectId(projects, readLastProjectId());
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!projectsLoaded || !effectiveProjectId) return;
    if (effectiveProjectId === selectedProjectId) return;

    const params = new URLSearchParams();
    params.set('project', effectiveProjectId);
    if (activeChatId) params.set('chat', activeChatId);
    router.replace(`/chat?${params.toString()}`);
  }, [activeChatId, effectiveProjectId, projectsLoaded, router, selectedProjectId]);

  useEffect(() => {
    if (effectiveProjectId) {
      void useInitiativeStore.getState().loadInitiative(effectiveProjectId);
      writeLastProjectId(effectiveProjectId);
    }
  }, [effectiveProjectId]);

  useEffect(() => {
    setPinnedEditorWidgets(null);
    setEditorWidgets([]);
    setAssumptionsWorkspaceOpen(false);
    setFocusedAssumptionId(null);
    setAssumptionsCreateNew(false);
  }, [effectiveProjectId, activeChatId]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === effectiveProjectId) ?? null,
    [projects, effectiveProjectId],
  );

  const effectiveEditorWidgets = pinnedEditorWidgets ?? editorWidgets;
  const showAssumptionsWorkspace = assumptionsWorkspaceOpen && Boolean(effectiveProjectId);
  const showAssumptionsSidePanel = showAssumptionsWorkspace && (Boolean(focusedAssumptionId) || assumptionsCreateNew);
  const showContextStack = !hasMessages && Boolean(effectiveProjectId) && !showAssumptionsWorkspace;
  const showEditorPanel = effectiveEditorWidgets.length > 0;
  const reserveRightSpace = showContextStack || showEditorPanel || showAssumptionsSidePanel;
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

  const handleCloseEditorPanel = useCallback(() => {
    setPinnedEditorWidgets(null);
    setEditorWidgets([]);
    if (!activeChatId) {
      setHasMessages(false);
    }
  }, [activeChatId]);

  const handleEditorWidgetsChange = useCallback((widgets: EditorWidget[]) => {
    setEditorWidgets(widgets);
    if (widgets.length > 0) setPinnedEditorWidgets(null);
  }, []);

  const handleOpenWorkspaceAssessment = useCallback(
    (assessment: {
      instanceId: string;
      assessmentId: string;
      title?: string | null;
    }) => {
      setHasMessages(true);
      setPinnedEditorWidgets([
        {
          type: 'assessment_workspace',
          data: {
            instance_id: assessment.instanceId,
            assessment_id: assessment.assessmentId,
            title: assessment.title,
          },
          messageId: `workspace-${assessment.instanceId}`,
        },
      ]);
    },
    [],
  );

  const handleOpenDocument = useCallback((citation: ResearchPanelCitation) => {
    setHasMessages(true);
    setPinnedEditorWidgets([editorWidgetForCitation(citation)]);
  }, []);

  const handleOpenProjectFile = useCallback((file: ProjectMaterial) => {
    setHasMessages(true);
    setPinnedEditorWidgets([editorWidgetForProjectMaterial(file)]);
  }, []);

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

  const handleOpenAssumptionsView = useCallback((assumption?: Assumption) => {
    setAssumptionsWorkspaceOpen(true);
    setFocusedAssumptionId(assumption?.id ?? null);
    setAssumptionsCreateNew(false);
  }, []);

  const handleAssumptionSelectInWorkspace = useCallback((assumption: Assumption) => {
    setFocusedAssumptionId(assumption.id);
    setAssumptionsCreateNew(false);
  }, []);

  const handleAddAssumptionInChat = useCallback(() => {
    setFocusedAssumptionId(null);
    setAssumptionsCreateNew(true);
  }, []);

  const resetLandingOverlays = useCallback((): boolean => {
    let didReset = false;

    if (assumptionsWorkspaceOpen) {
      setAssumptionsWorkspaceOpen(false);
      setFocusedAssumptionId(null);
      setAssumptionsCreateNew(false);
      didReset = true;
    }

    if (pinnedEditorWidgets?.length || editorWidgets.length) {
      setPinnedEditorWidgets(null);
      setEditorWidgets([]);
      didReset = true;
    }

    if (didReset && !activeChatId) {
      setHasMessages(false);
    }

    return didReset;
  }, [activeChatId, assumptionsWorkspaceOpen, editorWidgets.length, pinnedEditorWidgets]);

  useChatShellLandingReset(resetLandingOverlays);

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

  return (
    <div className="relative flex-1 flex flex-col min-h-0 min-w-0 h-full bg-surface">
      <div
        className={`flex-1 flex flex-col min-h-0 min-w-0 ${isResizingEditorPanel ? '' : 'transition-[padding-right] duration-300 ease-in-out'}`}
        style={{ paddingRight: rightGutter }}
      >
        <div className="flex-1 min-h-0">
          {showAssumptionsWorkspace && effectiveProjectId ? (
            <AssumptionsWorkspaceTab
              initiativeId={effectiveProjectId}
              showDetailPanel={false}
              focusAssumptionId={focusedAssumptionId}
              onAssumptionSelectInChat={handleAssumptionSelectInWorkspace}
              onAddAssumptionInChat={handleAddAssumptionInChat}
            />
          ) : effectiveProjectId ? (
            <ProjectChatSurface
              key={effectiveProjectId}
              initiativeId={effectiveProjectId}
              initialChatId={activeChatId}
              useLandingWhenEmpty
              hideTiles
              landingLayoutMode="default"
              landingComposerTitle={selectedProject?.name}
              landingHeaderContent={<></>}
              onLandingStateChange={(onLanding) => setHasMessages(!onLanding)}
              onEditorWidgetsChange={handleEditorWidgetsChange}
              onOpenWorkspaceAssessment={handleOpenWorkspaceAssessment}
              onOpenDocument={handleOpenDocument}
              onChatMetaChange={({ chatId }) => {
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

      {showContextStack && (
        <div className="absolute z-20 right-3 top-3 bottom-3 flex flex-col gap-3 w-[min(22rem,34vw)] pointer-events-none">
          <div className="pointer-events-auto min-h-0">
            <ProjectContextPanel
              variant="stacked"
              project={selectedProject}
              refreshKey={contextRefreshKey}
            />
          </div>
          <div className="pointer-events-auto flex-1 min-h-[8rem] flex flex-col min-w-0">
            <ProjectAssumptionsPanel
              projectId={effectiveProjectId}
              refreshKey={contextRefreshKey}
              onAssumptionSelect={(assumption) => handleOpenAssumptionsView(assumption)}
              onViewAll={() => handleOpenAssumptionsView()}
            />
          </div>
          <div className="pointer-events-auto min-h-0 flex flex-col min-w-0">
            <ProjectFilesPanel
              projectId={effectiveProjectId}
              refreshKey={contextRefreshKey}
              onOpenFile={handleOpenProjectFile}
            />
          </div>
        </div>
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
            initiativeId={effectiveProjectId}
            onClose={handleCloseEditorPanel}
          />
        </aside>
      )}

      {showAssumptionsSidePanel && effectiveProjectId && (
        <aside className={`${FLOATING_PANEL_CLASS} top-3 bottom-3 w-[min(22rem,34vw)]`}>
          <AssumptionsChatPanel
            initiativeId={effectiveProjectId}
            focusAssumptionId={focusedAssumptionId}
            createNew={assumptionsCreateNew}
            layoutMode="panel"
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
