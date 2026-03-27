'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Sprout, TreeDeciduous } from 'lucide-react';

import { useInitiativeStore } from '@/stores/initiativeStore';
import { ProjectHeader, ChatPanel, EditorSidePanel } from '@/components/editor';
import type { EditorWidget, RightPanelMode } from '@/components/editor';
import { ProjectPlanView } from '@/components/project-plan';
import { ProjectStandaloneChatView } from '@/components/core-chat/ProjectStandaloneChatView';
import { ResearchPanel } from '@/components/core-chat/ResearchPanel';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import { ProjectFilesView } from '@/components/files';
import { api } from '@/lib/api';
import type { SourceCitation } from '@/lib/api';
import { EvaluateView } from '@/components/evaluate/EvaluateView';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { SideDrawer, NavItem } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useSettingsStore } from '@/stores/settingsStore';
import { DocumentViewerWidget } from '@/components/widgets/DocumentViewerWidget';
import { useGoogleDriveStore } from '@/stores/googleDriveStore';
import { openGooglePicker } from '@/lib/googlePicker';

const MIN_STANDALONE_CHAT_PERCENT = 30;
const MAX_STANDALONE_CHAT_PERCENT = 60;
const DEFAULT_STANDALONE_CHAT_PERCENT = 55;
const MIN_RESEARCH_PANEL_PERCENT = 20;
const MAX_RESEARCH_PANEL_PERCENT = 25;
const DEFAULT_RESEARCH_PANEL_PERCENT = 25;
const MIN_PLAN_DOC_VIEWER_PERCENT = 25;
const MAX_PLAN_DOC_VIEWER_PERCENT = 55;
const DEFAULT_PLAN_DOC_VIEWER_PERCENT = 38;

type ProjectView = 'chat' | 'plan' | 'files' | 'evaluate';

function InitiativePageContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initiativeId = params.id as string;
  const { user, signOut } = useAuth();

  const handleSignOut = useCallback(async () => {
    await signOut();
    router.push('/');
  }, [signOut, router]);

  const standaloneContainerRef = useRef<HTMLDivElement>(null);
  const planContainerRef = useRef<HTMLDivElement>(null);

  const viewParam = searchParams.get('view');
  const viewFromUrl: ProjectView =
    viewParam === 'chat' ? 'chat' :
    viewParam === 'files' ? 'files' :
    viewParam === 'evaluate' ? 'evaluate' : 'plan';

  const [activeView, setActiveView] = useState<ProjectView>(viewFromUrl);
  const [evaluateKey, setEvaluateKey] = useState(0);
  const [showChatLanding, setShowChatLanding] = useState(true);
  const [standaloneChatWidthPercent, setStandaloneChatWidthPercent] = useState(DEFAULT_STANDALONE_CHAT_PERCENT);
  const [isResizingStandalone, setIsResizingStandalone] = useState(false);
  const [researchPanelWidthPercent, setResearchPanelWidthPercent] = useState(DEFAULT_RESEARCH_PANEL_PERCENT);
  const [isResizingResearch, setIsResizingResearch] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Page-level loading overlay — stays up until all 5 initial loads complete
  const [pageReady, setPageReady] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  // Header/sidebar can show as soon as the initiative itself loads (not waiting for all 5 fetches)
  const [chromeReady, setChromeReady] = useState(false);
  const [showSprout, setShowSprout] = useState(true);

  // Plan-view overlay — covers full workspace (chat + plan panels) when switching to plan
  const [planViewReady, setPlanViewReady] = useState(true);
  const [showPlanOverlay, setShowPlanOverlay] = useState(false);

  // Plan view panel state
  const [rightPanel, setRightPanel] = useState<RightPanelMode>('closed');
  const [showInspector, setShowInspector] = useState(false);
  const [hasInspectorItem, setHasInspectorItem] = useState(false);
  // Standalone chat view panel state
  const alignmentCallbackRef = useRef<((msgs: { id: string; role: string; content: string; widget_type?: string | null; widget_data?: Record<string, any> | null; created_at?: string | null }[]) => void) | null>(null);
  const [chatEditorWidgets, setChatEditorWidgets] = useState<EditorWidget[]>([]);
  const [showEditorInChatView, setShowEditorInChatView] = useState(false);
  const [showChatInChatView, setShowChatInChatView] = useState(true);
  // Research panel state (citation preview)
  const [researchCitation, setResearchCitation] = useState<ResearchPanelCitation | null>(null);
  // Plan view: document viewer panel (opened from deep dive panel)
  const [planDocViewer, setPlanDocViewer] = useState<ResearchPanelCitation | null>(null);
  const lastPlanDocViewerCitation = useRef<ResearchPanelCitation | null>(null);
  const [planDocViewerWidthPercent, setPlanDocViewerWidthPercent] = useState(DEFAULT_PLAN_DOC_VIEWER_PERCENT);
  const [isResizingPlanDoc, setIsResizingPlanDoc] = useState(false);

  useEffect(() => {
    setActiveView((prev) => (prev === viewFromUrl ? prev : viewFromUrl));
  }, [viewFromUrl]);
  
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
    loadInitiative, 
    loadChatHistory,
    loadEvidence,
    loadMaterials,
    loadProjectPlan,
    loadDriveLinkedFiles,
    syncDriveFiles,
    importFromDrive,
    sendMessage,
    updateTitle,
    uploadMaterial,
    deleteMaterial,
    reset,
  } = useInitiativeStore();

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

  // Viewers cannot access the generate/evaluate views; redirect to plan.
  useEffect(() => {
    if (isViewer && (activeView === 'chat' || activeView === 'evaluate')) {
      setActiveView('plan');
      router.replace(`/initiatives/${initiativeId}?view=plan`);
    }
  }, [isViewer, activeView, initiativeId, router]);

  useEffect(() => {
    if (initiativeId) {
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
        loadEvidence(initiativeId),
        loadMaterials(initiativeId),
        loadProjectPlan(initiativeId),
        loadDriveLinkedFiles(initiativeId).then(() => {
          // Silently sync any Drive-linked files in the background
          syncDriveFiles(initiativeId).catch(() => {});
        }),
      ]).finally(() => setPageReady(true));
    }
  }, [initiativeId, reset, loadInitiative, loadChatHistory, loadEvidence, loadMaterials, loadProjectPlan, loadDriveLinkedFiles, syncDriveFiles]);

  // Fade the overlay out after loads complete, then unmount it
  useEffect(() => {
    if (!pageReady) return;
    const timer = setTimeout(() => setShowOverlay(false), 350);
    return () => clearTimeout(timer);
  }, [pageReady]);

  // Alternate icons while either overlay is visible
  useEffect(() => {
    if (!showOverlay && !showPlanOverlay) return;
    const interval = setInterval(() => setShowSprout((p) => !p), 750);
    return () => clearInterval(interval);
  }, [showOverlay, showPlanOverlay]);

  // Plan overlay fade-out
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
    }
    prevPlanRef.current = hasPlan;
  }, [projectPlan]);

  // Auto-open editor in standalone chat view when widgets appear
  const prevHadChatEditor = useRef(false);
  useEffect(() => {
    const hasWidgets = chatEditorWidgets.length > 0;
    if (hasWidgets && !prevHadChatEditor.current) {
      setShowEditorInChatView(true);
    }
    prevHadChatEditor.current = hasWidgets;
  }, [chatEditorWidgets]);

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
    const viewerWidget: EditorWidget = {
      type: 'document_viewer',
      data: {
        evidence_doc_id: citation.evidence_doc_id,
        chunk_id: citation.chunk_id,
        source_title: citation.source_title,
      },
      messageId: 'citation-nav',
    };
    setChatEditorWidgets((prev) => {
      const filtered = prev.filter((w) => w.type !== 'document_viewer');
      return [...filtered, viewerWidget];
    });
    setShowEditorInChatView(true);
  }, []);

  const handleOpenFullDocFromPlan = useCallback((citation: ResearchPanelCitation) => {
    lastPlanDocViewerCitation.current = citation;
    setPlanDocViewer((prev) =>
      prev?.evidence_doc_id === citation.evidence_doc_id ? null : citation
    );
  }, []);

  const handleStandaloneMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizingStandalone || !standaloneContainerRef.current) return;
    const rect = standaloneContainerRef.current.getBoundingClientRect();
    const newWidthPercent = ((e.clientX - rect.left) / rect.width) * 100;
    // Cap chat so editor keeps ≥ 40%; account for current research panel width when both are open
    const maxPercent = researchCitation
      ? 100 - researchPanelWidthPercent - 40
      : MAX_STANDALONE_CHAT_PERCENT;
    setStandaloneChatWidthPercent(
      Math.min(maxPercent, Math.max(MIN_STANDALONE_CHAT_PERCENT, newWidthPercent))
    );
  }, [isResizingStandalone, researchCitation, researchPanelWidthPercent]);

  const handleStandaloneMouseUp = useCallback(() => {
    setIsResizingStandalone(false);
  }, []);

  const handleResearchMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizingResearch || !standaloneContainerRef.current) return;
    const rect = standaloneContainerRef.current.getBoundingClientRect();
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
    if (isResizingStandalone) {
      document.addEventListener('mousemove', handleStandaloneMouseMove);
      document.addEventListener('mouseup', handleStandaloneMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleStandaloneMouseMove);
      document.removeEventListener('mouseup', handleStandaloneMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingStandalone, handleStandaloneMouseMove, handleStandaloneMouseUp]);

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

  const handleToggleInspector = () => {
    if (hasInspectorItem) {
      setShowInspector(prev => !prev);
    }
  };

  const handleSendMessage = (content: string) => {
    sendMessage(initiativeId, content);
  };

  const handleTitleUpdate = (title: string) => {
    updateTitle(initiativeId, title);
  };

  const handlePlanReady = useCallback(() => setPlanViewReady(true), []);

  const handleNavChange = (item: NavItem) => {
    if (item === 'home') {
      // If the user never sent a message (abandoned the onboarding), clean up the empty project
      const hasUserMessage = messages.some((m) => m.role === 'user');
      if (!hasUserMessage && initiative) {
        api.permanentlyDeleteInitiative(initiative.id).catch(() => {});
      }
      router.push('/');
      return;
    }
    if (item === 'chat') {
      setActiveView('chat');
      setShowChatLanding(true);
      setShowEditorInChatView(false);
      setResearchCitation(null);
      router.replace(`/initiatives/${initiativeId}?view=chat`);
      return;
    }
    if (item === 'files') {
      setActiveView('files');
      router.replace(`/initiatives/${initiativeId}?view=files`);
      return;
    }
    if (item === 'plan') {
      setPlanViewReady(false);
      setShowPlanOverlay(true);
      loadProjectPlan(initiativeId).finally(handlePlanReady);
      setActiveView('plan');
      router.replace(`/initiatives/${initiativeId}?view=plan`);
      return;
    }
    if (item === 'evaluate') {
      setActiveView('evaluate');
      setEvaluateKey((k) => k + 1);
      router.replace(`/initiatives/${initiativeId}?view=evaluate`);
    }
  };

  const handleNewChat = () => {
    setShowChatLanding(true);
    setShowEditorInChatView(false);
    setResearchCitation(null);
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* ProjectHeader — shows as soon as initiative loads, independent of secondary data */}
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
            } : undefined,
          } : activeView === 'chat' && !isViewer ? {
            onNewChat: !showChatLanding ? handleNewChat : undefined,
            rightToggle: !showChatLanding && chatEditorWidgets.length > 0 ? {
              active: showEditorInChatView,
              onClick: () => {
                setShowEditorInChatView((p) => !p);
                if (!showEditorInChatView) setShowChatInChatView(true);
              },
              title: showEditorInChatView ? 'Hide editor' : 'Show editor',
            } : undefined,
          } : {})}
        />
      )}
      </div>

      {/* Content row: sidebar + inset workspace */}
      <div className="flex flex-1 min-h-0">
        <div className={`flex-shrink-0 transition-opacity duration-300 ${chromeReady ? 'opacity-100' : 'opacity-0'} ${!chromeReady ? 'pointer-events-none' : ''}`}>
        <SideDrawer
          variant="project"
          activeItem={activeView}
          onItemSelect={handleNavChange}
          onSignOut={handleSignOut}
          userEmail={user?.email}
          onUploadMaterial={isViewer ? undefined : (file) => uploadMaterial(initiativeId, file)}
          hiddenItems={isViewer ? ['chat', 'evaluate'] : devMode ? undefined : ['evaluate']}
          initiativeId={initiativeId}
        />
        </div>

        <div className="flex-1 p-2 pt-0 pl-1 min-h-0">
          <div className="h-full bg-surface rounded-lg shadow-workspace overflow-hidden relative">
            {/* Loading overlay — blurs content while initial data loads */}
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
                {/* Chat view — always mounted to preserve conversation state across view switches */}
                <main
                  ref={standaloneContainerRef}
                  className={`h-full min-w-0 flex overflow-hidden relative ${activeView !== 'chat' ? 'hidden' : ''}`}
                >
                  {/* Left: chat column */}
                  {(() => {
                    const hasEditor = showEditorInChatView && chatEditorWidgets.length > 0;
                    const hasResearch = !!researchCitation;
                    // When only research is open, chat is fixed at 85% (no resize needed).
                    // When editor is open, chat is resizable; cap at 45% when research is also visible
                    // so the editor always gets its minimum 40%.
                    const chatWidth = hasEditor
                      ? `${Math.min(hasResearch ? 100 - researchPanelWidthPercent - 40 : MAX_STANDALONE_CHAT_PERCENT, standaloneChatWidthPercent)}%`
                      : hasResearch
                        ? `${100 - researchPanelWidthPercent}%`
                        : '100%';

                    return (
                      <>
                        <div
                          className="flex-shrink-0 relative overflow-hidden"
                          style={{ width: chatWidth }}
                        >
                          <div className="absolute inset-0 overflow-hidden">
                            <ProjectStandaloneChatView
                              initiativeId={initiativeId}
                              showLanding={showChatLanding}
                              onMessageSent={() => setShowChatLanding(false)}
                              onBack={handleNewChat}
                              onEditorWidgetsChange={handleChatEditorWidgetsChange}
                              onCitationClick={handleCitationClick}
                              onAlignmentConfirmedRef={alignmentCallbackRef}
                            />
                          </div>
                          {/* Resize handle only shown when editor is open */}
                          {hasEditor && (
                            <div
                              onMouseDown={(e) => { e.preventDefault(); setIsResizingStandalone(true); }}
                              className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/30 transition-colors ${isResizingStandalone ? 'bg-accent/50' : 'bg-transparent'}`}
                            />
                          )}
                        </div>

                        {/* Research panel — 20–25% wide, resizable from the left edge */}
                        {hasResearch && (
                          <div
                            className="flex-shrink-0 overflow-hidden relative"
                            style={{ width: `${researchPanelWidthPercent}%` }}
                          >
                            <div
                              onMouseDown={(e) => { e.preventDefault(); setIsResizingResearch(true); }}
                              className={`absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-accent/30 transition-colors z-10 ${isResizingResearch ? 'bg-accent/50' : 'bg-transparent'}`}
                            />
                            <ResearchPanel
                              key={`${researchCitation!.evidence_doc_id}-${researchCitation!.chunk_id}`}
                              citation={researchCitation!}
                              onClose={() => setResearchCitation(null)}
                              onOpenFullDoc={handleOpenFullDoc}
                            />
                          </div>
                        )}

                        {/* Right: editor / document viewer — flex-1 with minimum 40% */}
                        {hasEditor && (
                          <div
                            className="flex-1 overflow-hidden border-l border-divider"
                            style={{ minWidth: '40%' }}
                          >
                            <EditorSidePanel
                              widgets={chatEditorWidgets}
                              initiativeId={initiativeId}
                              onAlignmentConfirmed={(msgs) => alignmentCallbackRef.current?.(msgs)}
                            />
                          </div>
                        )}
                      </>
                    );
                  })()}
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
              <main ref={planContainerRef} className="h-full min-w-0 flex overflow-hidden relative">
                {/* Plan-view overlay — covers chat panel + plan panel */}
                {showPlanOverlay && (
                  <div
                    className={`absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-surface/95 backdrop-blur-xl transition-opacity duration-300 ${planViewReady ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
                  >
                    <div className="relative w-10 h-10">
                      <div className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${showSprout ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`}>
                        <Sprout className="w-6 h-6 text-accent" strokeWidth={1.5} />
                      </div>
                      <div className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${!showSprout ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`}>
                        <TreeDeciduous className="w-6 h-6 text-accent" strokeWidth={1.5} />
                      </div>
                    </div>
                    <span className="text-xs text-text-secondary font-medium tracking-wide">Loading plan…</span>
                  </div>
                )}

                {uploadError && (
                  <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-2">
                    <div className="bg-indicator-orange/10 border border-indicator-orange/30 rounded px-4 py-3 shadow-lg max-w-md">
                      <p className="text-sm text-indicator-orange font-medium">{uploadError}</p>
                    </div>
                  </div>
                )}

                {rightPanelOpen ? (
                  <>
                  <div className="flex-1 overflow-hidden min-w-0">
                    {showProjectPlan && (
                      <ProjectPlanView
                        initiativeId={initiativeId}
                        showInspector={showInspector}
                        onInspectorChange={handleInspectorChange}
                        onOpenFullDoc={handleOpenFullDocFromPlan}
                      />
                    )}
                  </div>
                  {planDocViewer && (
                    <div
                      className="flex-shrink-0 border-l border-divider flex flex-col bg-surface overflow-hidden relative"
                      style={{ width: `${planDocViewerWidthPercent}%` }}
                    >
                      {/* Resize handle on left edge */}
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
                  )}
                  </>
                  ) : !isViewer ? (
                  <div className="flex-1 overflow-hidden h-full">
                    <ChatPanel
                      messages={messages}
                      sending={sending}
                      generating={generating}
                      initiativeId={initiativeId}
                      onSendMessage={handleSendMessage}
                      fullWidth={true}
                      hasProjectPlan={hasProjectPlan}
                    />
                  </div>
                ) : (
                  <div className="flex-1 overflow-hidden h-full flex items-center justify-center">
                    <p className="text-sm text-text-tertiary">No project plan yet</p>
                  </div>
                )}
              </main>
              ) : activeView === 'evaluate' ? (
              <main className="h-full min-w-0 overflow-hidden">
                <EvaluateView key={evaluateKey} initiativeId={initiativeId} />
              </main>
              ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InitiativePage() {
  return (
    <ProtectedRoute>
      <InitiativePageContent />
    </ProtectedRoute>
  );
}
