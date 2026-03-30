'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Sprout, TreeDeciduous, X } from 'lucide-react';

import dynamic from 'next/dynamic';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { useShallow } from 'zustand/react/shallow';
import { ProjectHeader, ChatPanel, EditorSidePanel } from '@/components/editor';
import type { EditorWidget, RightPanelMode } from '@/components/editor';
import { ProjectStandaloneChatView } from '@/components/core-chat/ProjectStandaloneChatView';
import { ModalShell } from '@/components/ui/ModalShell';
import type { ModuleInstance } from '@/lib/api';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import { api } from '@/lib/api';
import type { SourceCitation } from '@/lib/api';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useShellNav } from '@/components/ui/ShellContext';
import type { NavItem } from '@/components/ui/SideDrawer';
import { useSettingsStore } from '@/stores/settingsStore';
import { useGoogleDriveStore } from '@/stores/googleDriveStore';
import { openGooglePicker } from '@/lib/googlePicker';

const ProjectPlanView = dynamic(() => import('@/components/project-plan').then(m => ({ default: m.ProjectPlanView })), { ssr: false });
const ProjectFilesView = dynamic(() => import('@/components/files').then(m => ({ default: m.ProjectFilesView })), { ssr: false });
const ResearchPanel = dynamic(() => import('@/components/core-chat/ResearchPanel').then(m => ({ default: m.ResearchPanel })), { ssr: false });
const ModuleLandingPage = dynamic(() => import('@/components/chat/ModuleLandingPage').then(m => ({ default: m.ModuleLandingPage })), { ssr: false });
const OpenModuleModal = dynamic(() => import('@/components/chat/OpenModuleModal').then(m => ({ default: m.OpenModuleModal })), { ssr: false });
const DocumentViewerWidget = dynamic(() => import('@/components/widgets/DocumentViewerWidget').then(m => ({ default: m.DocumentViewerWidget })), { ssr: false });

const MIN_STANDALONE_CHAT_PERCENT = 30;
const MAX_STANDALONE_CHAT_PERCENT = 60;
const DEFAULT_STANDALONE_CHAT_PERCENT = 55;
const MIN_RESEARCH_PANEL_PERCENT = 20;
const MAX_RESEARCH_PANEL_PERCENT = 25;
const DEFAULT_RESEARCH_PANEL_PERCENT = 25;
const MIN_PLAN_DOC_VIEWER_PERCENT = 25;
const MAX_PLAN_DOC_VIEWER_PERCENT = 55;
const DEFAULT_PLAN_DOC_VIEWER_PERCENT = 38;

type ProjectView = 'explore' | 'plan' | 'files';

function InitiativePageContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initiativeId = params.id as string;

  const standaloneContainerRef = useRef<HTMLDivElement>(null);
  const planContainerRef = useRef<HTMLDivElement>(null);
  const chatSendRef = useRef<((content: string, toolHint?: string) => void) | null>(null);

  const viewParam = searchParams.get('view');
  const viewFromUrl: ProjectView =
    viewParam === 'explore' ? 'explore' :
    viewParam === 'files' ? 'files' : 'plan';

  const [activeView, setActiveView] = useState<ProjectView>(viewFromUrl);
  const [showModuleModal, setShowModuleModal] = useState(false);
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [showChatLanding, setShowChatLanding] = useState(true);
  const [standaloneChatWidthPercent, setStandaloneChatWidthPercent] = useState(DEFAULT_STANDALONE_CHAT_PERCENT);
  const [isResizingStandalone, setIsResizingStandalone] = useState(false);
  const [researchPanelWidthPercent, setResearchPanelWidthPercent] = useState(DEFAULT_RESEARCH_PANEL_PERCENT);
  const [isResizingResearch, setIsResizingResearch] = useState(false);
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
  const alignmentCallbackRef = useRef<((msgs: { id: string; role: string; content: string; widget_type?: string | null; widget_data?: Record<string, any> | null; created_at?: string | null }[]) => void) | null>(null);
  const [chatEditorWidgets, setChatEditorWidgets] = useState<EditorWidget[]>([]);
  const [showEditorInChatView, setShowEditorInChatView] = useState(false);
  const [showChatInChatView, setShowChatInChatView] = useState(true);
  const [researchCitation, setResearchCitation] = useState<ResearchPanelCitation | null>(null);
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
    if (item === 'explore') {
      setActiveView('explore');
      setShowChatLanding(true);
      setShowEditorInChatView(false);
      setResearchCitation(null);
      router.replace(`/initiatives/${initiativeId}?view=explore`);
      return true;
    }
    if (item === 'modules') {
      setShowModuleModal(true);
      return true;
    }
    if (item === 'open') {
      setShowOpenModal(true);
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
  }, [messages, initiative, router, initiativeId, loadProjectPlan, handlePlanReady]));

  useEffect(() => {
    if (isViewer && activeView === 'explore') {
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
    }
    prevPlanRef.current = hasPlan;
  }, [projectPlan]);

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

  const handleSendMessage = (content: string) => {
    sendMessage(initiativeId, content);
  };

  const handleTitleUpdate = (title: string) => {
    updateTitle(initiativeId, title);
  };

  const handleNewChat = () => {
    setShowChatLanding(true);
    setShowEditorInChatView(false);
    setResearchCitation(null);
  };

  const handleOpenInstanceSelect = useCallback((instance: ModuleInstance) => {
    setShowOpenModal(false);
    setActiveView('explore');
    setShowChatLanding(false);
    setShowEditorInChatView(false);
    setResearchCitation(null);
    router.replace(`/initiatives/${initiativeId}?view=explore`);
    const TOOL_NAMES: Record<string, string> = {
      lcoe_model: 'LCOE Model',
      carbon_model: 'Carbon Calculator',
      solar_estimate: 'Solar Estimate',
      investment_memo: 'Investment Memo',
      due_diligence_checklist: 'Due Diligence',
      template_fill: 'Template',
    };
    const name = TOOL_NAMES[instance.tool_id] ?? instance.tool_id.replace(/_/g, ' ');
    setTimeout(() => {
      chatSendRef.current?.(`Generate ${name}`, instance.tool_id);
    }, 0);
  }, [initiativeId, router]);

  const handleModuleSelect = useCallback((moduleId: string, moduleName: string) => {
    setShowModuleModal(false);
    setActiveView('explore');
    setShowChatLanding(false);
    setShowEditorInChatView(false);
    setResearchCitation(null);
    router.replace(`/initiatives/${initiativeId}?view=explore`);
    setTimeout(() => {
      chatSendRef.current?.(`Generate ${moduleName}`, moduleId);
    }, 0);
  }, [initiativeId, router]);

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
            } : undefined,
          } : activeView === 'explore' && !isViewer ? {
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
              {/* Explore (chat) view — always mounted to preserve conversation state */}
              <main
                ref={standaloneContainerRef}
                className={`h-full min-w-0 flex overflow-hidden relative ${activeView !== 'explore' ? 'hidden' : ''}`}
              >
                {(() => {
                  const hasEditor = showEditorInChatView && chatEditorWidgets.length > 0;
                  const hasResearch = !!researchCitation;
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
                            hideTiles={true}
                            onMessageSent={() => setShowChatLanding(false)}
                            onBack={handleNewChat}
                            onEditorWidgetsChange={handleChatEditorWidgetsChange}
                            onCitationClick={handleCitationClick}
                            onAlignmentConfirmedRef={alignmentCallbackRef}
                            onSendRef={chatSendRef}
                          />
                        </div>
                        {hasEditor && (
                          <div
                            onMouseDown={(e) => { e.preventDefault(); setIsResizingStandalone(true); }}
                            className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/30 transition-colors ${isResizingStandalone ? 'bg-accent/50' : 'bg-transparent'}`}
                          />
                        )}
                      </div>

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

              {showOpenModal && (
                <OpenModuleModal
                  initiativeId={initiativeId}
                  onSelect={handleOpenInstanceSelect}
                  onClose={() => setShowOpenModal(false)}
                />
              )}

              {showModuleModal && (
                <ModalShell onClose={() => setShowModuleModal(false)} maxWidth="max-w-3xl">
                  <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-stroke-subtle">
                    <h2 className="text-sm font-semibold text-text-primary">New Module</h2>
                    <button
                      onClick={() => setShowModuleModal(false)}
                      className="p-1 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
                      aria-label="Close"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {/* max-h on the element itself gives overflow-y-auto a definite bound */}
                  <div className="max-h-[calc(90vh-4rem)] overflow-y-auto">
                    <ModuleLandingPage onSelectModule={handleModuleSelect} showIntro={false} />
                  </div>
                </ModalShell>
              )}

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
