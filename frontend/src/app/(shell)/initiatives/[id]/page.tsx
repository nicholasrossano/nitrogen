'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useShallow } from 'zustand/react/shallow';

import { ChatPanel, ProjectHeader } from '@/components/editor';
import type { EditorWidget, WorkspacePanelTab } from '@/components/editor';
import { ProjectWorkspaceEditorPanel } from '@/components/editor/ProjectWorkspaceEditorPanel';
import type { WorkspaceLaunchMode } from '@/components/editor/WorkspaceHub';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ProjectChatTabsPanel } from '@/components/core-chat/ProjectChatTabsPanel';
import type { ResearchPanelCitation } from '@/components/core-chat/ResearchPanel';
import { useShellNav } from '@/components/ui/ShellContext';
import type { NavItem } from '@/components/ui/SideDrawer';
import { PageLoader } from '@/components/ui/PageLoader';
import { api, type SourceCitation } from '@/lib/api';
import { openGooglePicker } from '@/lib/googlePicker';
import { useGoogleDriveStore } from '@/stores/googleDriveStore';
import { useInitiativeStore } from '@/stores/initiativeStore';

const ProjectPlanView = dynamic(() => import('@/components/project-plan').then((m) => ({ default: m.ProjectPlanView })), { ssr: false });
const ProjectFilesView = dynamic(() => import('@/components/files').then((m) => ({ default: m.ProjectFilesView })), { ssr: false });
const ResearchPanel = dynamic(() => import('@/components/core-chat/ResearchPanel').then((m) => ({ default: m.ResearchPanel })), { ssr: false });

const MIN_RESEARCH_PANEL_PERCENT = 20;
const MAX_RESEARCH_PANEL_PERCENT = 25;
const DEFAULT_RESEARCH_PANEL_PERCENT = 25;
const MIN_CHAT_PANEL_PERCENT = 20;
const MAX_CHAT_PANEL_PERCENT = 60;
const DEFAULT_CHAT_PANEL_PERCENT = 30;

type InitiativeView = 'overview' | 'modules' | 'framework' | 'files';

function viewFromSearchParam(viewParam: string | null): InitiativeView {
  if (viewParam === 'research' || viewParam === 'explore') return 'overview';
  if (viewParam === 'framework' || viewParam === 'plan') return 'framework';
  if (viewParam === 'workspace' || viewParam === 'modules') return 'modules';
  if (viewParam === 'files') return 'files';
  return 'overview';
}

function makeDocumentTabId(citation: ResearchPanelCitation): string {
  return `document-${citation.evidence_doc_id}-${citation.chunk_id ?? 'root'}`;
}

function isDocumentTab(tab: WorkspacePanelTab | null): tab is Extract<WorkspacePanelTab, { kind: 'document' }> {
  return tab?.kind === 'document';
}

function InitiativePageContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initiativeId = params.id as string;

  const workspaceContainerRef = useRef<HTMLDivElement>(null);
  const chatSendRef = useRef<((content: string, toolHint?: string) => void) | null>(null);

  const viewParam = searchParams.get('view');
  const viewFromUrl = viewFromSearchParam(viewParam);

  const [activeView, setActiveView] = useState<InitiativeView>(viewFromUrl);
  const [chatPanels, setChatPanels] = useState({
    modules: { open: false },
    framework: { open: false },
  });
  const [researchPanelWidthPercent, setResearchPanelWidthPercent] = useState(DEFAULT_RESEARCH_PANEL_PERCENT);
  const [isResizingResearch, setIsResizingResearch] = useState(false);
  const [chatPanelWidthPercent, setChatPanelWidthPercent] = useState(DEFAULT_CHAT_PANEL_PERCENT);
  const [isResizingChat, setIsResizingChat] = useState(false);

  const [pageReady, setPageReady] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [chromeReady, setChromeReady] = useState(false);
  const [planViewReady, setPlanViewReady] = useState(true);
  const [showPlanOverlay, setShowPlanOverlay] = useState(false);

  const [showInspector, setShowInspector] = useState(false);
  const [chatEditorWidgets, setChatEditorWidgets] = useState<EditorWidget[]>([]);
  const [researchCitation, setResearchCitation] = useState<ResearchPanelCitation | null>(null);
  const [workspaceLaunchMode, setWorkspaceLaunchMode] = useState<WorkspaceLaunchMode>('idle');
  const [pendingChatToOpen, setPendingChatToOpen] = useState<{ chatId: string; title?: string | null } | null>(null);
  const [preferArtifactsTab, setPreferArtifactsTab] = useState(false);
  const [researchLandingResetSignal, setResearchLandingResetSignal] = useState(0);
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspacePanelTab[]>([]);
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState<string | null>(null);

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
  const getDriveAccessToken = useGoogleDriveStore((s) => s.getAccessToken);
  const driveConnected = useGoogleDriveStore((s) => s.connected);
  const connectDrive = useGoogleDriveStore((s) => s.connect);

  const hasProjectPlan = Boolean(projectPlan);
  const activeWorkspaceTab = useMemo(
    () => workspaceTabs.find((tab) => tab.id === activeWorkspaceTabId) ?? null,
    [workspaceTabs, activeWorkspaceTabId],
  );
  const visibleWorkspaceTabs = useMemo(
    () => (activeView === 'modules' ? workspaceTabs : workspaceTabs.filter((tab) => tab.kind === 'document')),
    [activeView, workspaceTabs],
  );
  const visibleWorkspaceActiveTabId = useMemo(
    () => (visibleWorkspaceTabs.some((tab) => tab.id === activeWorkspaceTabId) ? activeWorkspaceTabId : null),
    [visibleWorkspaceTabs, activeWorkspaceTabId],
  );
  const showTabbedWorkspace = activeView === 'modules' || isDocumentTab(activeWorkspaceTab);
  const modulesChatOpen = activeView === 'modules' && chatPanels.modules.open;
  const frameworkChatOpen = activeView === 'framework' && hasProjectPlan && chatPanels.framework.open;
  const sideChatOpen = modulesChatOpen || frameworkChatOpen;

  const setChatPanelOpen = useCallback((view: 'modules' | 'framework', open: boolean) => {
    setChatPanels((prev) => ({
      ...prev,
      [view]: { open },
    }));
  }, []);

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
      if (activeView !== 'modules' || chatPanels.modules.open) return;

      setChatPanelOpen('modules', true);
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
  }, [activeView, chatPanels.modules.open, setChatPanelOpen]);

  const handleFilesViewDriveImport = useCallback(async () => {
    if (!driveConnected) {
      connectDrive(initiativeId);
      return;
    }
    const accessToken = await getDriveAccessToken();
    return new Promise<void>((resolve, reject) => {
      openGooglePicker(accessToken, async (files) => {
        if (files.length === 0) {
          resolve();
          return;
        }
        try {
          await importFromDrive(initiativeId, files.map((f) => f.id));
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }, [driveConnected, connectDrive, getDriveAccessToken, importFromDrive, initiativeId]);

  const handlePlanReady = useCallback(() => setPlanViewReady(true), []);

  useShellNav(useCallback((item: NavItem): boolean => {
    if (item === 'home') {
      const hasUserMessage = messages.some((message) => message.role === 'user');
      if (!hasUserMessage && initiative) {
        api.permanentlyDeleteInitiative(initiative.id).catch(() => {});
      }
      router.push('/');
      return true;
    }
    if (item === 'research') {
      if (activeView === 'overview') {
        setResearchLandingResetSignal((prev) => prev + 1);
      }
      setActiveView('overview');
      router.replace(`/initiatives/${initiativeId}?view=research`);
      return true;
    }
    if (item === 'workspace') {
      setActiveView('modules');
      router.replace(`/initiatives/${initiativeId}?view=modules`);
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
      setActiveView('framework');
      router.replace(`/initiatives/${initiativeId}?view=framework`);
      return true;
    }
    return false;
  }, [messages, initiative, router, initiativeId, loadProjectPlan, handlePlanReady, activeView]));

  useEffect(() => {
    if (isViewer && (activeView === 'overview' || activeView === 'modules')) {
      setActiveView('framework');
      router.replace(`/initiatives/${initiativeId}?view=framework`);
    }
  }, [isViewer, activeView, initiativeId, router]);

  useEffect(() => {
    if (!initiativeId) return;

    setChatPanels({
      modules: { open: false },
      framework: { open: false },
    });
    setWorkspaceTabs([]);
    setActiveWorkspaceTabId(null);
    setShowInspector(false);
    setResearchCitation(null);
    setChatEditorWidgets([]);
    setWorkspaceLaunchMode('idle');
    setPendingChatToOpen(null);
    setPreferArtifactsTab(false);
    setPageReady(false);
    setChromeReady(false);
    setShowOverlay(true);
    setShowPlanOverlay(false);
    setPlanViewReady(true);

    reset();
    const initiativeLoad = loadInitiative(initiativeId);
    initiativeLoad.finally(() => setChromeReady(true));
    Promise.all([
      initiativeLoad,
      loadChatHistory(initiativeId),
    ]).finally(() => setPageReady(true));

    loadEvidence(initiativeId);
    loadMaterials(initiativeId);
    loadDriveLinkedFiles(initiativeId).then(() => {
      syncDriveFiles(initiativeId).catch(() => {});
    });
  }, [initiativeId, reset, loadInitiative, loadChatHistory, loadEvidence, loadMaterials, loadDriveLinkedFiles, syncDriveFiles]);

  useEffect(() => {
    if (!pageReady) return;
    const timer = window.setTimeout(() => setShowOverlay(false), 350);
    return () => window.clearTimeout(timer);
  }, [pageReady]);

  useEffect(() => {
    if (!planViewReady || !showPlanOverlay) return;
    const timer = window.setTimeout(() => setShowPlanOverlay(false), 350);
    return () => window.clearTimeout(timer);
  }, [planViewReady, showPlanOverlay]);

  useEffect(() => {
    if (activeView === 'modules') return;
    setShowInspector(false);
  }, [activeView]);

  useEffect(() => {
    if (activeView === 'framework' || activeView === 'modules' || activeView === 'overview') return;
    setResearchCitation(null);
  }, [activeView]);

  useEffect(() => {
    const hasArtifactsTab = workspaceTabs.some((tab) => tab.id === 'chat-artifacts');
    if (chatEditorWidgets.length > 0 && !hasArtifactsTab) {
      setWorkspaceTabs((prev) => [...prev, { id: 'chat-artifacts', kind: 'artifacts', title: 'Chat Outputs' }]);
      return;
    }

    if (chatEditorWidgets.length === 0 && hasArtifactsTab) {
      setWorkspaceTabs((prev) => prev.filter((tab) => tab.id !== 'chat-artifacts'));
      setActiveWorkspaceTabId((current) => {
        if (current !== 'chat-artifacts') return current;
        if (activeView === 'modules') {
          const fallbackTabs = workspaceTabs.filter((tab) => tab.id !== 'chat-artifacts');
          return fallbackTabs[0]?.id ?? null;
        }
        const fallbackDocument = workspaceTabs.find(
          (tab) => tab.id !== 'chat-artifacts' && tab.kind === 'document',
        );
        return fallbackDocument?.id ?? null;
      });
    }
  }, [chatEditorWidgets.length, workspaceTabs, activeView]);

  useEffect(() => {
    if (!preferArtifactsTab || !chatEditorWidgets.length) return;
    setActiveWorkspaceTabId('chat-artifacts');
    setPreferArtifactsTab(false);
  }, [preferArtifactsTab, chatEditorWidgets.length]);

  useEffect(() => {
    if (activeView !== 'modules') return;
    if (activeWorkspaceTabId !== null) return;
    if (workspaceTabs.length === 0) return;
    setActiveWorkspaceTabId(workspaceTabs[0].id);
  }, [activeView, activeWorkspaceTabId, workspaceTabs]);

  const openWorkspaceTab = useCallback((tab: WorkspacePanelTab) => {
    setWorkspaceTabs((prev) => (prev.some((existingTab) => existingTab.id === tab.id) ? prev : [...prev, tab]));
    setActiveWorkspaceTabId(tab.id);
  }, []);

  const handleOpenWorkspaceModule = useCallback(
    (module: { instanceId: string; moduleId: string; title?: string | null }) => {
      setWorkspaceLaunchMode('idle');
      setActiveView('modules');
      router.replace(`/initiatives/${initiativeId}?view=modules`);
      openWorkspaceTab({
        id: `module-${module.instanceId}`,
        kind: 'module',
        title: module.title || module.moduleId.replace(/_/g, ' '),
        instanceId: module.instanceId,
        moduleId: module.moduleId,
      });
    },
    [initiativeId, openWorkspaceTab, router],
  );

  const openWorkspaceDocument = useCallback((citation: ResearchPanelCitation) => {
    openWorkspaceTab({
      id: makeDocumentTabId(citation),
      kind: 'document',
      title: citation.source_title || 'Document',
      citation,
    });
  }, [openWorkspaceTab]);

  const closeWorkspaceTab = useCallback((tabId: string) => {
    setWorkspaceTabs((prev) => {
      const nextTabs = prev.filter((tab) => tab.id !== tabId);
      setActiveWorkspaceTabId((current) => {
        if (current !== tabId) return current;
        if (activeView === 'modules') {
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
      return;
    }
    if (citation.source_url) {
      window.open(citation.source_url, '_blank', 'noopener');
    }
  }, []);

  const handleResearchMouseMove = useCallback((event: MouseEvent) => {
    if (!isResizingResearch || !workspaceContainerRef.current) return;
    const rect = workspaceContainerRef.current.getBoundingClientRect();
    const nextPercent = ((rect.right - event.clientX) / rect.width) * 100;
    setResearchPanelWidthPercent(
      Math.min(MAX_RESEARCH_PANEL_PERCENT, Math.max(MIN_RESEARCH_PANEL_PERCENT, nextPercent)),
    );
  }, [isResizingResearch]);

  const handleResearchMouseUp = useCallback(() => {
    setIsResizingResearch(false);
  }, []);

  const handleChatMouseMove = useCallback((event: MouseEvent) => {
    if (!isResizingChat || !workspaceContainerRef.current) return;
    const rect = workspaceContainerRef.current.getBoundingClientRect();
    const nextPercent = ((rect.right - event.clientX) / rect.width) * 100;
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

  const handleInspectorChange = useCallback((open: boolean) => {
    setShowInspector(open);
  }, []);

  const handleSendMessage = useCallback((content: string) => {
    sendMessage(initiativeId, content);
  }, [initiativeId, sendMessage]);

  const handleTitleUpdate = useCallback((title: string) => {
    updateTitle(initiativeId, title);
  }, [initiativeId, updateTitle]);

  const renderPlanOverlay = showPlanOverlay ? (
    <div
      className={`absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-surface/95 backdrop-blur-xl transition-opacity duration-300 ${planViewReady ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
    >
      <PageLoader label="" />
    </div>
  ) : null;

  const renderResearchPanel = researchCitation ? (
    <div
      className="relative flex-shrink-0 overflow-hidden border-l border-divider"
      style={{ width: `${researchPanelWidthPercent}%` }}
    >
      <div
        onMouseDown={(event) => {
          event.preventDefault();
          setIsResizingResearch(true);
        }}
        className={`absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-accent/30 transition-colors z-10 ${isResizingResearch ? 'bg-accent/50' : 'bg-transparent'}`}
      />
      <ResearchPanel
        key={`${researchCitation.evidence_doc_id}-${researchCitation.chunk_id}`}
        citation={researchCitation}
        onClose={() => setResearchCitation(null)}
        onOpenFullDoc={openWorkspaceDocument}
      />
    </div>
  ) : null;

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
          showModuleActions={activeView === 'modules'}
          onSendToChat={(content, toolHint) => {
            setChatPanelOpen('modules', true);
            chatSendRef.current?.(content, toolHint);
          }}
          onOpenChatSession={(chat) => {
            setChatPanelOpen('modules', true);
            setPreferArtifactsTab(true);
            setPendingChatToOpen(chat);
          }}
        />
      );
    }

    if (activeView === 'overview') {
      return (
        <div className="h-full flex overflow-hidden">
          <div className="flex-1 min-w-0">
            <ProjectChatTabsPanel
              initiativeId={initiativeId}
              researchMode={true}
              resetToLandingSignal={researchLandingResetSignal}
              onEditorWidgetsChange={handleChatEditorWidgetsChange}
              onCitationClick={handleCitationClick}
              onOpenWorkspaceModule={handleOpenWorkspaceModule}
            />
          </div>
          {renderResearchPanel}
        </div>
      );
    }

    if (activeView === 'framework') {
      if (!hasProjectPlan && !isViewer) {
        return (
          <ChatPanel
            messages={messages}
            sending={sending}
            generating={generating}
            initiativeId={initiativeId}
            onSendMessage={handleSendMessage}
            fullWidth={true}
            hasProjectPlan={hasProjectPlan}
          />
        );
      }

      if (!hasProjectPlan) {
        return (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-text-tertiary">No framework yet</p>
          </div>
        );
      }

      return (
        <div className="relative h-full">
          {renderPlanOverlay}
          <ProjectPlanView
            initiativeId={initiativeId}
            showInspector={showInspector}
            onInspectorChange={handleInspectorChange}
            onOpenFullDoc={openWorkspaceDocument}
            onViewModeChange={() => setShowInspector(false)}
          />
        </div>
      );
    }

    return <div className="h-full" />;
  })();

  const sideChatContent = modulesChatOpen ? (
    <div className="h-full flex overflow-hidden">
      <div className="flex-1 min-w-0">
        <ProjectChatTabsPanel
          initiativeId={initiativeId}
          researchMode={false}
          pendingChatToOpen={pendingChatToOpen}
          onPendingSessionHandled={() => setPendingChatToOpen(null)}
          onEditorWidgetsChange={handleChatEditorWidgetsChange}
          onCitationClick={handleCitationClick}
          onOpenWorkspaceModule={handleOpenWorkspaceModule}
          onSendRef={chatSendRef}
        />
      </div>
      {renderResearchPanel}
    </div>
  ) : frameworkChatOpen ? (
    <ChatPanel
      messages={messages}
      sending={sending}
      generating={generating}
      initiativeId={initiativeId}
      onSendMessage={handleSendMessage}
      hasProjectPlan={hasProjectPlan}
      readOnly={Boolean(isViewer)}
    />
  ) : null;

  return (
    <>
      <div className={`flex-shrink-0 h-14 transition-opacity duration-300 ${chromeReady ? 'opacity-100' : 'opacity-0'}`}>
        {initiative && (
          <ProjectHeader
            initiative={initiative}
            onTitleUpdate={isViewer ? undefined : handleTitleUpdate}
            readOnly={Boolean(isViewer)}
            {...(activeView === 'modules'
              ? {
                  rightToggle: {
                    active: modulesChatOpen,
                    onClick: () => setChatPanelOpen('modules', !modulesChatOpen),
                    title: modulesChatOpen ? 'Hide chat' : 'Show chat',
                    icon: 'chat' as const,
                  },
                }
              : activeView === 'framework' && hasProjectPlan
                ? {
                    rightToggle: {
                      active: frameworkChatOpen,
                      onClick: () => setChatPanelOpen('framework', !frameworkChatOpen),
                      title: frameworkChatOpen ? 'Hide chat' : 'Show chat',
                      icon: 'chat' as const,
                    },
                  }
                : {})}
          />
        )}
      </div>

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
              <div className="flex-1 min-w-0 overflow-hidden">{primaryWorkspaceContent}</div>

              {sideChatOpen && (
                <>
                  <div
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setIsResizingChat(true);
                    }}
                    className={`w-2 flex-shrink-0 cursor-col-resize relative group ${isResizingChat ? 'bg-accent/10' : ''}`}
                  >
                    <div className={`absolute left-1/2 top-0 h-full -translate-x-1/2 w-px transition-colors ${isResizingChat ? 'bg-accent/60' : 'bg-divider group-hover:bg-accent/40'}`} />
                  </div>

                  <div className="flex-shrink-0 overflow-hidden" style={{ width: `${chatPanelWidthPercent}%` }}>
                    {sideChatContent}
                  </div>
                </>
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
