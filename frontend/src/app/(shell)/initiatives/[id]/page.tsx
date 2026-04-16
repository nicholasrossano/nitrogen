'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Sprout, TreeDeciduous, X } from 'lucide-react';

import dynamic from 'next/dynamic';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { useShallow } from 'zustand/react/shallow';
import { ProjectHeader, ChatPanel } from '@/components/editor';
import type { EditorWidget, RightPanelMode } from '@/components/editor';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import { api } from '@/lib/api';
import type { SourceCitation } from '@/lib/api';
import { PlanWorkspaceRouteShell } from '@/components/plan-workspace';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useShellNav } from '@/components/ui/ShellContext';
import type { NavItem } from '@/components/ui/SideDrawer';
import { useSettingsStore } from '@/stores/settingsStore';
import { useGoogleDriveStore } from '@/stores/googleDriveStore';
import { openGooglePicker } from '@/lib/googlePicker';
import { ProjectChatTabsPanel } from '@/components/core-chat/ProjectChatTabsPanel';
import { ProjectWorkspaceEditorPanel } from '@/components/editor/ProjectWorkspaceEditorPanel';
import type { WorkspaceLaunchMode } from '@/components/editor/WorkspaceHub';

const ProjectPlanView = dynamic(() => import('@/components/project-plan').then(m => ({ default: m.ProjectPlanView })), { ssr: false });
const ProjectFilesView = dynamic(() => import('@/components/files').then(m => ({ default: m.ProjectFilesView })), { ssr: false });
const ResearchPanel = dynamic(() => import('@/components/core-chat/ResearchPanel').then(m => ({ default: m.ResearchPanel })), { ssr: false });
const DocumentViewerWidget = dynamic(() => import('@/components/widgets/DocumentViewerWidget').then(m => ({ default: m.DocumentViewerWidget })), { ssr: false });

const MIN_RESEARCH_PANEL_PERCENT = 20;
const MAX_RESEARCH_PANEL_PERCENT = 25;
const DEFAULT_RESEARCH_PANEL_PERCENT = 25;
const MIN_CHAT_PANEL_PERCENT = 20;
const MAX_CHAT_PANEL_PERCENT = 60;
const DEFAULT_CHAT_PANEL_PERCENT = 30;
const MIN_PLAN_DOC_VIEWER_PERCENT = 25;
const MAX_PLAN_DOC_VIEWER_PERCENT = 55;
const DEFAULT_PLAN_DOC_VIEWER_PERCENT = 38;

type ProjectView = 'research' | 'workspace' | 'plan' | 'files';

function InitiativePageContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initiativeId = params.id as string;

  const workspaceContainerRef = useRef<HTMLDivElement>(null);
  const planContainerRef = useRef<HTMLDivElement>(null);
  const chatSendRef = useRef<((content: string, toolHint?: string) => void) | null>(null);

  const viewParam = searchParams.get('view');
  const viewFromUrl: ProjectView =
    viewParam === 'research' || viewParam === 'explore' ? 'research' :
    viewParam === 'workspace' ? 'workspace' :
    viewParam === 'files' ? 'files' : 'research';

  const [activeView, setActiveView] = useState<ProjectView>(viewFromUrl);
  const [surfacePanels, setSurfacePanels] = useState({
    research: { chatOpen: true, editorOpen: false },
    workspace: { chatOpen: false, editorOpen: true },
  });
  const [researchPanelWidthPercent, setResearchPanelWidthPercent] = useState(DEFAULT_RESEARCH_PANEL_PERCENT);
  const [isResizingResearch, setIsResizingResearch] = useState(false);
  const [chatPanelWidthPercent, setChatPanelWidthPercent] = useState(DEFAULT_CHAT_PANEL_PERCENT);
  const [isResizingChat, setIsResizingChat] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [pageReady, setPageReady] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [chromeReady, setChromeReady] = useState(false);
  const [showSprout, setShowSprout] = useState(true);

  const [planViewReady, setPlanViewReady] = useState(true);
  const [showPlanOverlay, setShowPlanOverlay] = useState(false);

  const [rightPanel, setRightPanel] = useState<RightPanelMode>('closed');
  const [showInspector, setShowInspector] = useState(false);
  const [hasInspectorItem, setHasInspectorItem] = useState(false);
  const [chatEditorWidgets, setChatEditorWidgets] = useState<EditorWidget[]>([]);
  const [researchCitation, setResearchCitation] = useState<ResearchPanelCitation | null>(null);
  const [pendingEditorDocument, setPendingEditorDocument] = useState<ResearchPanelCitation | null>(null);
  const [workspaceLaunchMode, setWorkspaceLaunchMode] = useState<WorkspaceLaunchMode>('idle');
  const [pendingChatSessionToOpen, setPendingChatSessionToOpen] = useState<{ sessionId: string; title?: string | null } | null>(null);
  const [preferArtifactsTab, setPreferArtifactsTab] = useState(false);
  const [researchLandingResetSignal, setResearchLandingResetSignal] = useState(0);
  const [planDocViewer, setPlanDocViewer] = useState<ResearchPanelCitation | null>(null);
  const lastPlanDocViewerCitation = useRef<ResearchPanelCitation | null>(null);
  const [planDocViewerWidthPercent, setPlanDocViewerWidthPercent] = useState(DEFAULT_PLAN_DOC_VIEWER_PERCENT);
  const [isResizingPlanDoc, setIsResizingPlanDoc] = useState(false);
  const hasEnteredWorkspaceRef = useRef(false);
  const activeSurfaceView = activeView === 'research' || activeView === 'workspace' ? activeView : null;
  const chatPanelOpen = activeSurfaceView ? surfacePanels[activeSurfaceView].chatOpen : false;
  const editorPanelOpen = activeSurfaceView ? surfacePanels[activeSurfaceView].editorOpen : false;

  const setSurfacePanelState = useCallback(
    (surface: 'research' | 'workspace', next: Partial<{ chatOpen: boolean; editorOpen: boolean }>) => {
      setSurfacePanels((prev) => ({
        ...prev,
        [surface]: {
          ...prev[surface],
          ...next,
        },
      }));
    },
    [],
  );

  useEffect(() => {
    setActiveView((prev) => (prev === viewFromUrl ? prev : viewFromUrl));
  }, [viewFromUrl]);

  useEffect(() => {
    if (activeView !== 'workspace' || hasEnteredWorkspaceRef.current) return;
    setSurfacePanelState('workspace', { chatOpen: false, editorOpen: true });
    hasEnteredWorkspaceRef.current = true;
  }, [activeView, setSurfacePanelState]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail ?? {};
      if (detail._workspaceForwarded) return;
      if (activeView !== 'workspace' || chatPanelOpen) return;

      setSurfacePanelState('workspace', { chatOpen: true, editorOpen: true });
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
  }, [activeView, chatPanelOpen, setSurfacePanelState]);
  
  const {
    initiative,
    messages,
    projectPlan,
    projectMaterials,
    driveLinkedFiles,
    loading,
    sending,
    generating,
    error,
  } = useInitiativeStore(useShallow((s) => ({
    initiative: s.initiative,
    messages: s.messages,
    projectPlan: s.projectPlan,
    projectMaterials: s.projectMaterials,
    driveLinkedFiles: s.driveLinkedFiles,
    loading: s.loading,
    sending: s.sending,
    generating: s.generating,
    error: s.error,
  })));

  const loadInitiative = useInitiativeStore((s) => s.loadInitiative);
  const loadChatHistory = useInitiativeStore((s) => s.loadChatHistory);
  const loadEvidence = useInitiativeStore((s) => s.loadEvidence);
  const loadMaterials = useInitiativeStore((s) => s.loadMaterials);
  const loadProjectPlan = useInitiativeStore((s) => s.loadProjectPlan);
  const loadDriveLinkedFiles = useInitiativeStore((s) => s.loadDriveLinkedFiles);
  const syncDriveFiles = useInitiativeStore((s) => s.syncDriveFiles);
  const importFromDrive = useInitiativeStore((s) => s.importFromDrive);
  const sendMessage = useInitiativeStore((s) => s.sendMessage);
  const updateTitle = useInitiativeStore((s) => s.updateTitle);
  const uploadMaterial = useInitiativeStore((s) => s.uploadMaterial);
  const deleteMaterial = useInitiativeStore((s) => s.deleteMaterial);
  const reset = useInitiativeStore((s) => s.reset);

  const isViewer = initiative?.shared_role === 'viewer';
  const devMode = useSettingsStore((s) => s.devMode);
  const getDriveAccessToken = useGoogleDriveStore((s) => s.getAccessToken);
  const driveConnected = useGoogleDriveStore((s) => s.connected);
  const connectDrive = useGoogleDriveStore((s) => s.connect);

  const handleFilesViewDriveImport = useCallback(async () => {
    if (!driveConnected) {
      connectDrive(initiativeId);
      return;
    }
    const accessToken = await getDriveAccessToken();
    return new Promise<void>((resolve, reject) => {
      openGooglePicker(accessToken, async (files) => {
        if (files.length === 0) { resolve(); return; }
        try {
          await importFromDrive(initiativeId, files.map((f) => f.id));
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }, [driveConnected, connectDrive, getDriveAccessToken, importFromDrive, initiativeId]);

  const hasProjectPlan = !!projectPlan;
  const showProjectPlan = rightPanel === 'project_plan';
  const rightPanelOpen = rightPanel !== 'closed';

  const handlePlanReady = useCallback(() => setPlanViewReady(true), []);

  // Register nav handler so the persistent SideDrawer delegates to us
  useShellNav(useCallback((item: NavItem): boolean => {
    if (item === 'home') {
      const hasUserMessage = messages.some((m) => m.role === 'user');
      if (!hasUserMessage && initiative) {
        api.permanentlyDeleteInitiative(initiative.id).catch(() => {});
      }
      router.push('/');
      return true;
    }
    if (item === 'research') {
      if (activeView === 'research') {
        setResearchLandingResetSignal((prev) => prev + 1);
      }
      setActiveView('research');
      setSurfacePanelState('research', { chatOpen: true, editorOpen: false });
      router.replace(`/initiatives/${initiativeId}?view=research`);
      return true;
    }
    if (item === 'workspace') {
      setActiveView('workspace');
      router.replace(`/initiatives/${initiativeId}?view=workspace`);
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
      setActiveView('plan');
      router.replace(`/initiatives/${initiativeId}?view=plan`);
      return true;
    }
    return false;
  }, [messages, initiative, router, initiativeId, loadProjectPlan, handlePlanReady, setSurfacePanelState, activeView]));

  useEffect(() => {
    if (isViewer && (activeView === 'research' || activeView === 'workspace')) {
      setActiveView('plan');
      router.replace(`/initiatives/${initiativeId}?view=plan`);
    }
  }, [isViewer, activeView, initiativeId, router]);

  useEffect(() => {
    if (initiativeId) {
      hasEnteredWorkspaceRef.current = false;
      setSurfacePanels({
        research: { chatOpen: true, editorOpen: false },
        workspace: { chatOpen: false, editorOpen: true },
      });
      // Sync prevPlanRef BEFORE reset() so the [projectPlan] effect below won't mistake
      // the stale plan from a previous initiative for a newly-generated plan and
      // prematurely open the plan panel for a brand-new project.
      prevPlanRef.current = !!useInitiativeStore.getState().projectPlan;
      reset();
      setRightPanel('closed');
      setPageReady(false);
      setChromeReady(false);
      setShowOverlay(true);
      const initiativeLoad = loadInitiative(initiativeId);
      initiativeLoad.finally(() => setChromeReady(true));
      Promise.all([
        initiativeLoad,
        loadChatHistory(initiativeId),
      ]).finally(() => setPageReady(true));
      // Non-critical: load in background, not blocking the overlay
      loadEvidence(initiativeId);
      loadMaterials(initiativeId);
      loadDriveLinkedFiles(initiativeId).then(() => {
        syncDriveFiles(initiativeId).catch(() => {});
      });
    }
  }, [initiativeId, reset, loadInitiative, loadChatHistory, loadEvidence, loadMaterials, loadDriveLinkedFiles, syncDriveFiles]);

  useEffect(() => {
    if (!pageReady) return;
    const timer = setTimeout(() => setShowOverlay(false), 350);
    return () => clearTimeout(timer);
  }, [pageReady]);

  useEffect(() => {
    if (!showOverlay && !showPlanOverlay) return;
    const interval = setInterval(() => setShowSprout((p) => !p), 750);
    return () => clearInterval(interval);
  }, [showOverlay, showPlanOverlay]);

  useEffect(() => {
    if (!planViewReady || !showPlanOverlay) return;
    const timer = setTimeout(() => setShowPlanOverlay(false), 350);
    return () => clearTimeout(timer);
  }, [planViewReady, showPlanOverlay]);

  const prevPlanRef = useRef<boolean>(false);
  useEffect(() => {
    const hasPlan = !!projectPlan;
    if (hasPlan && !prevPlanRef.current) {
      setRightPanel('project_plan');
    } else if (!hasPlan && prevPlanRef.current) {
      // If a plan disappears (or stale state is cleared), fall back to onboarding chat.
      setRightPanel('closed');
    }
    prevPlanRef.current = hasPlan;
  }, [projectPlan]);

  const prevHadChatEditor = useRef(false);
  useEffect(() => {
    const hasWidgets = chatEditorWidgets.length > 0;
    if (
      hasWidgets &&
      !prevHadChatEditor.current &&
      (activeView === 'research' || activeView === 'workspace')
    ) {
      setSurfacePanelState(activeView, { editorOpen: true });
    }
    prevHadChatEditor.current = hasWidgets;
  }, [chatEditorWidgets, activeView, setSurfacePanelState]);

  const handleChatEditorWidgetsChange = useCallback((widgets: EditorWidget[]) => {
    setChatEditorWidgets(widgets);
  }, []);

  const handleCitationClick = useCallback((citation: SourceCitation) => {
    if (
      (citation.source_type === 'corpus' || citation.source_type === 'evidence') &&
      citation.evidence_doc_id
    ) {
      setResearchCitation({
        evidence_doc_id: citation.evidence_doc_id,
        chunk_id: citation.chunk_id ?? null,
        source_title: citation.source_title,
      });
    } else if (citation.source_url) {
      window.open(citation.source_url, '_blank', 'noopener');
    }
  }, []);

  const handleOpenFullDoc = useCallback((citation: ResearchPanelCitation) => {
    setPendingEditorDocument(citation);
    if (activeView === 'research' || activeView === 'workspace') {
      setSurfacePanelState(activeView, { editorOpen: true });
    }
  }, [activeView, setSurfacePanelState]);

  const handleOpenFullDocFromPlan = useCallback((citation: ResearchPanelCitation) => {
    lastPlanDocViewerCitation.current = citation;
    setPlanDocViewer((prev) =>
      prev?.evidence_doc_id === citation.evidence_doc_id ? null : citation
    );
  }, []);

  const handleResearchMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizingResearch || !workspaceContainerRef.current) return;
    const rect = workspaceContainerRef.current.getBoundingClientRect();
    const newResearchPercent = ((rect.right - e.clientX) / rect.width) * 100;
    setResearchPanelWidthPercent(
      Math.min(MAX_RESEARCH_PANEL_PERCENT, Math.max(MIN_RESEARCH_PANEL_PERCENT, newResearchPercent))
    );
  }, [isResizingResearch]);

  const handleResearchMouseUp = useCallback(() => {
    setIsResizingResearch(false);
  }, []);

  const handlePlanDocMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizingPlanDoc || !planContainerRef.current) return;
    const rect = planContainerRef.current.getBoundingClientRect();
    const newPercent = ((rect.right - e.clientX) / rect.width) * 100;
    setPlanDocViewerWidthPercent(
      Math.min(MAX_PLAN_DOC_VIEWER_PERCENT, Math.max(MIN_PLAN_DOC_VIEWER_PERCENT, newPercent))
    );
  }, [isResizingPlanDoc]);

  const handlePlanDocMouseUp = useCallback(() => {
    setIsResizingPlanDoc(false);
  }, []);

  const handleChatMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizingChat || !workspaceContainerRef.current) return;
    const rect = workspaceContainerRef.current.getBoundingClientRect();
    const newChatPercent = ((rect.right - e.clientX) / rect.width) * 100;
    setChatPanelWidthPercent(
      Math.min(MAX_CHAT_PANEL_PERCENT, Math.max(MIN_CHAT_PANEL_PERCENT, newChatPercent))
    );
  }, [isResizingChat]);

  const handleChatMouseUp = useCallback(() => {
    setIsResizingChat(false);
  }, []);

  useEffect(() => {
    if (isResizingPlanDoc) {
      document.addEventListener('mousemove', handlePlanDocMouseMove);
      document.addEventListener('mouseup', handlePlanDocMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handlePlanDocMouseMove);
      document.removeEventListener('mouseup', handlePlanDocMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingPlanDoc, handlePlanDocMouseMove, handlePlanDocMouseUp]);

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

  useEffect(() => {
    if (isResizingResearch) {
      document.addEventListener('mousemove', handleResearchMouseMove);
      document.addEventListener('mouseup', handleResearchMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleResearchMouseMove);
      document.removeEventListener('mouseup', handleResearchMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingResearch, handleResearchMouseMove, handleResearchMouseUp]);

  const handleInspectorChange = useCallback((open: boolean, hasItem: boolean) => {
    setShowInspector(open);
    if (hasItem) setHasInspectorItem(true);
  }, []);

  const handleSendMessage = (content: string) => {
    sendMessage(initiativeId, content);
  };

  const handleTitleUpdate = (title: string) => {
    updateTitle(initiativeId, title);
  };

  return (
    <>
      {/* ProjectHeader — shows as soon as initiative loads */}
      <div className={`flex-shrink-0 h-14 transition-opacity duration-300 ${chromeReady ? 'opacity-100' : 'opacity-0'}`}>
      {initiative && (
        <ProjectHeader
          initiative={initiative}
          onTitleUpdate={isViewer ? undefined : handleTitleUpdate}
          readOnly={isViewer}
          {...(activeView === 'plan' ? {
            rightToggle: rightPanel === 'project_plan' ? {
              active: planDocViewer !== null,
              disabled: lastPlanDocViewerCitation.current === null,
              onClick: () => {
                if (planDocViewer !== null) {
                  setPlanDocViewer(null);
                } else if (lastPlanDocViewerCitation.current) {
                  setPlanDocViewer(lastPlanDocViewerCitation.current);
                }
              },
              title: planDocViewer !== null ? 'Hide document viewer' : 'Show document viewer',
              icon: 'editor' as const,
            } : undefined,
          } : (activeView === 'research' || activeView === 'workspace') && !isViewer ? {
            leftToggle: {
              active: editorPanelOpen,
              disabled: !chatPanelOpen,
              onClick: () => setSurfacePanelState(activeView, {
                editorOpen: chatPanelOpen ? !editorPanelOpen : true,
              }),
              title: editorPanelOpen ? 'Hide editor' : 'Show editor',
              icon: 'workspace',
            },
            rightToggle: {
              active: chatPanelOpen,
              disabled: !editorPanelOpen,
              onClick: () => setSurfacePanelState(activeView, {
                chatOpen: editorPanelOpen ? !chatPanelOpen : true,
              }),
              title: chatPanelOpen ? 'Hide chat' : 'Show chat',
              icon: 'chat',
            },
          } : {})}
        />
      )}
      </div>

      {/* Inset workspace */}
      <div className="flex-1 p-2 pt-0 pl-1 min-h-0">
        <div className="h-full bg-surface rounded-lg shadow-workspace overflow-hidden relative">
          {showOverlay && (
            <div
              className={`absolute inset-0 z-50 flex flex-col items-center justify-center gap-1.5 bg-surface/95 backdrop-blur-xl transition-opacity duration-300 ${pageReady ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
            >
              <div className="relative w-10 h-10">
                <div className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${showSprout ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`}>
                  <Sprout className="w-6 h-6 text-accent" strokeWidth={1.5} />
                </div>
                <div className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${!showSprout ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`}>
                  <TreeDeciduous className="w-6 h-6 text-accent" strokeWidth={1.5} />
                </div>
              </div>
              <span className="text-xs text-text-secondary font-medium tracking-wide">Loading project…</span>
            </div>
          )}

          {loading && !initiative ? (
            <div className="h-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-accent" />
                <span className="text-sm text-text-secondary">Loading project...</span>
              </div>
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
            ) : <div className="h-full" />
          ) : (
            <>
              <main
                ref={workspaceContainerRef}
                className={`h-full min-w-0 flex overflow-hidden relative ${(activeView !== 'research' && activeView !== 'workspace') ? 'hidden' : ''}`}
              >
                {editorPanelOpen && (
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <ProjectWorkspaceEditorPanel
                      initiativeId={initiativeId}
                      chatWidgets={chatEditorWidgets}
                      pendingDocument={pendingEditorDocument}
                      onPendingDocumentHandled={() => setPendingEditorDocument(null)}
                      workspaceLaunchMode={workspaceLaunchMode}
                      onWorkspaceLaunchModeHandled={() => setWorkspaceLaunchMode('idle')}
                      preferArtifactsTab={preferArtifactsTab}
                      onArtifactsTabPreferredHandled={() => setPreferArtifactsTab(false)}
                      onSendToChat={(content, toolHint) => {
                        setSurfacePanelState('workspace', { chatOpen: true });
                        chatSendRef.current?.(content, toolHint);
                      }}
                      onOpenChatSession={(session) => {
                        setSurfacePanelState('workspace', { chatOpen: true, editorOpen: true });
                        setPreferArtifactsTab(true);
                        setPendingChatSessionToOpen(session);
                      }}
                    />
                  </div>
                )}

                {editorPanelOpen && chatPanelOpen && (
                  <div
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setIsResizingChat(true);
                    }}
                    className={`w-2 flex-shrink-0 cursor-col-resize relative group ${isResizingChat ? 'bg-accent/10' : ''}`}
                  >
                    <div className={`absolute left-1/2 top-0 h-full -translate-x-1/2 w-px transition-colors ${isResizingChat ? 'bg-accent/60' : 'bg-divider group-hover:bg-accent/40'}`} />
                  </div>
                )}

                {chatPanelOpen && (
                  <div
                    className={`flex-shrink-0 overflow-hidden ${editorPanelOpen ? '' : 'flex-1'}`}
                    style={editorPanelOpen ? { width: `${chatPanelWidthPercent}%` } : undefined}
                  >
                    <div className="h-full flex overflow-hidden">
                      <div className="flex-1 min-w-0">
                        <div className={activeView === 'research' ? 'h-full' : 'hidden'}>
                          <ProjectChatTabsPanel
                            initiativeId={initiativeId}
                            researchMode={true}
                            resetToLandingSignal={researchLandingResetSignal}
                            onEditorWidgetsChange={activeView === 'research' ? handleChatEditorWidgetsChange : undefined}
                            onCitationClick={activeView === 'research' ? handleCitationClick : undefined}
                          />
                        </div>
                        <div className={activeView === 'workspace' ? 'h-full' : 'hidden'}>
                          <ProjectChatTabsPanel
                            initiativeId={initiativeId}
                            researchMode={false}
                            pendingSessionToOpen={pendingChatSessionToOpen}
                            onPendingSessionHandled={() => setPendingChatSessionToOpen(null)}
                            onEditorWidgetsChange={activeView === 'workspace' ? handleChatEditorWidgetsChange : undefined}
                            onCitationClick={activeView === 'workspace' ? handleCitationClick : undefined}
                            onSendRef={chatSendRef}
                          />
                        </div>
                      </div>
                      {researchCitation && (
                        <div
                          className="relative flex-shrink-0 overflow-hidden border-l border-divider"
                          style={{ width: `${researchPanelWidthPercent}%` }}
                        >
                          <div
                            onMouseDown={(e) => { e.preventDefault(); setIsResizingResearch(true); }}
                            className={`absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-accent/30 transition-colors z-10 ${isResizingResearch ? 'bg-accent/50' : 'bg-transparent'}`}
                          />
                          <ResearchPanel
                            key={`${researchCitation.evidence_doc_id}-${researchCitation.chunk_id}`}
                            citation={researchCitation}
                            onClose={() => setResearchCitation(null)}
                            onOpenFullDoc={handleOpenFullDoc}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </main>

              {activeView === 'files' ? (
            <main className="h-full min-w-0 overflow-hidden">
              <ProjectFilesView
                initiativeId={initiativeId}
                materials={projectMaterials}
                onDeleteMaterial={isViewer ? undefined : deleteMaterial}
                onUploadFile={isViewer ? undefined : (file) => uploadMaterial(initiativeId, file)}
                onImportFromDrive={isViewer ? undefined : handleFilesViewDriveImport}
                driveLinkedFiles={driveLinkedFiles}
                onSyncDriveFiles={isViewer ? undefined : async () => { await syncDriveFiles(initiativeId); }}
              />
            </main>
          ) : activeView === 'plan' ? (
            <div ref={planContainerRef} className="h-full min-w-0 flex overflow-hidden relative">
              <PlanWorkspaceRouteShell
                ready={planViewReady}
                showOverlay={showPlanOverlay}
                showSprout={showSprout}
                uploadError={uploadError}
                panelOpen={rightPanelOpen}
                readOnly={!!isViewer}
                hasPlan={hasProjectPlan}
                mainContent={showProjectPlan ? (
                  <ProjectPlanView
                    initiativeId={initiativeId}
                    showInspector={showInspector}
                    onInspectorChange={handleInspectorChange}
                    onOpenFullDoc={handleOpenFullDocFromPlan}
                  />
                ) : null}
                onboardingContent={
                  <ChatPanel
                    messages={messages}
                    sending={sending}
                    generating={generating}
                    initiativeId={initiativeId}
                    onSendMessage={handleSendMessage}
                    fullWidth={true}
                    hasProjectPlan={hasProjectPlan}
                  />
                }
                emptyContent={<p className="text-sm text-text-tertiary">No project plan yet</p>}
                documentViewer={planDocViewer ? (
                  <div
                    className="flex-shrink-0 border-l border-divider flex flex-col bg-surface overflow-hidden relative"
                    style={{ width: `${planDocViewerWidthPercent}%` }}
                  >
                    <div
                      onMouseDown={(e) => { e.preventDefault(); setIsResizingPlanDoc(true); }}
                      className={`absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-accent/30 transition-colors z-10 ${isResizingPlanDoc ? 'bg-accent/50' : 'bg-transparent'}`}
                    />
                    <div className="flex-1 min-h-0">
                      <DocumentViewerWidget
                        data={{
                          evidence_doc_id: planDocViewer.evidence_doc_id,
                          chunk_id: planDocViewer.chunk_id,
                          source_title: planDocViewer.source_title,
                        }}
                        initiativeId={initiativeId}
                        onClose={() => setPlanDocViewer(null)}
                      />
                    </div>
                  </div>
                ) : undefined}
              />
            </div>
            ) : null}
            </>
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
