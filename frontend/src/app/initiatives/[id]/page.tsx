'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';

import { useInitiativeStore } from '@/stores/initiativeStore';
import { ProjectHeader, ChatPanel, EditorSidePanel, EDITOR_WIDGET_TYPES } from '@/components/editor';
import type { EditorWidget, RightPanelMode } from '@/components/editor';
import { ProjectPlanView } from '@/components/project-plan';
import { ProjectStandaloneChatView } from '@/components/core-chat/ProjectStandaloneChatView';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { SideDrawer, NavItem } from '@/components/ui';

const MIN_CHAT_WIDTH_PERCENT = 20;
const MAX_CHAT_WIDTH_PERCENT = 40;
const DEFAULT_CHAT_WIDTH_PERCENT = 30;

const MIN_STANDALONE_CHAT_PERCENT = 30;
const MAX_STANDALONE_CHAT_PERCENT = 70;
const DEFAULT_STANDALONE_CHAT_PERCENT = 55;

type ProjectView = 'chat' | 'plan';

function InitiativePageContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initiativeId = params.id as string;
  const containerRef = useRef<HTMLDivElement>(null);
  const standaloneContainerRef = useRef<HTMLDivElement>(null);

  const viewParam = searchParams.get('view');
  const viewFromUrl: ProjectView = viewParam === 'chat' ? 'chat' : 'plan';

  const [activeView, setActiveView] = useState<ProjectView>(viewFromUrl);
  const [showChatLanding, setShowChatLanding] = useState(true);
  const [chatWidthPercent, setChatWidthPercent] = useState(DEFAULT_CHAT_WIDTH_PERCENT);
  const [isResizing, setIsResizing] = useState(false);
  const [standaloneChatWidthPercent, setStandaloneChatWidthPercent] = useState(DEFAULT_STANDALONE_CHAT_PERCENT);
  const [isResizingStandalone, setIsResizingStandalone] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Plan view panel state
  const [rightPanel, setRightPanel] = useState<RightPanelMode>('closed');
  const [showChatPanel, setShowChatPanel] = useState(true);
  const [showInspector, setShowInspector] = useState(false);
  const [hasInspectorItem, setHasInspectorItem] = useState(false);
  // Standalone chat view panel state
  const [chatEditorWidgets, setChatEditorWidgets] = useState<EditorWidget[]>([]);
  const [showEditorInChatView, setShowEditorInChatView] = useState(false);
  const [showChatInChatView, setShowChatInChatView] = useState(true);

  useEffect(() => {
    setActiveView((prev) => (prev === viewFromUrl ? prev : viewFromUrl));
  }, [viewFromUrl]);
  
  const { 
    initiative, 
    messages,
    projectPlan,
    projectMaterials,
    loading, 
    sending,
    generating,
    error, 
    loadInitiative, 
    loadChatHistory,
    loadEvidence,
    loadMaterials,
    loadProjectPlan,
    sendMessage,
    updateTitle,
    uploadMaterial,
    deleteMaterial,
  } = useInitiativeStore();

  const editorWidgets: EditorWidget[] = useMemo(
    () =>
      messages
        .filter(
          (m) =>
            m.widget_type &&
            m.widget_data &&
            (EDITOR_WIDGET_TYPES as readonly string[]).includes(m.widget_type),
        )
        .map((m) => ({
          type: m.widget_type!,
          data: m.widget_data!,
          messageId: m.id,
        })),
    [messages],
  );

  const hasEditorContent = editorWidgets.length > 0;
  const hasProjectPlan = !!projectPlan;
  const showProjectPlan = rightPanel === 'project_plan';
  const showEditor = rightPanel === 'editor';
  const rightPanelOpen = rightPanel !== 'closed';

  useEffect(() => {
    if (initiativeId) {
      loadInitiative(initiativeId);
      loadChatHistory(initiativeId);
      loadEvidence(initiativeId);
      loadMaterials(initiativeId);
      loadProjectPlan(initiativeId);
    }
  }, [initiativeId, loadInitiative, loadChatHistory, loadEvidence, loadMaterials, loadProjectPlan]);

  const prevPlanRef = useRef<boolean>(false);
  useEffect(() => {
    const hasPlan = !!projectPlan;
    if (hasPlan && !prevPlanRef.current) {
      setRightPanel('project_plan');
    }
    prevPlanRef.current = hasPlan;
  }, [projectPlan]);

  const prevHadEditor = useRef(false);
  useEffect(() => {
    if (hasEditorContent && !prevHadEditor.current && rightPanel === 'closed') {
      setRightPanel('editor');
    }
    prevHadEditor.current = hasEditorContent;
  }, [hasEditorContent, rightPanel]);

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

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const newWidthPercent = ((e.clientX - containerRect.left) / containerRect.width) * 100;
    setChatWidthPercent(
      Math.min(MAX_CHAT_WIDTH_PERCENT, Math.max(MIN_CHAT_WIDTH_PERCENT, newWidthPercent))
    );
  }, [isResizing]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handleStandaloneMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizingStandalone || !standaloneContainerRef.current) return;
    const rect = standaloneContainerRef.current.getBoundingClientRect();
    const newWidthPercent = ((e.clientX - rect.left) / rect.width) * 100;
    setStandaloneChatWidthPercent(
      Math.min(MAX_STANDALONE_CHAT_PERCENT, Math.max(MIN_STANDALONE_CHAT_PERCENT, newWidthPercent))
    );
  }, [isResizingStandalone]);

  const handleStandaloneMouseUp = useCallback(() => {
    setIsResizingStandalone(false);
  }, []);

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

  const handleToggleChatPanel = () => {
    setShowChatPanel(prev => !prev);
  };

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

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleNavChange = (item: NavItem) => {
    if (item === 'home') {
      router.push('/');
      return;
    }
    if (item === 'chat') {
      setActiveView('chat');
      setShowChatLanding(true);
      setShowEditorInChatView(false);
      router.replace(`/initiatives/${initiativeId}?view=chat`);
      return;
    }
    if (item === 'plan') {
      setActiveView('plan');
      router.replace(`/initiatives/${initiativeId}?view=plan`);
    }
  };

  const handleNewChat = () => {
    setShowChatLanding(true);
    setShowEditorInChatView(false);
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* ProjectHeader — full width, only when initiative is loaded */}
      {initiative && (
        <ProjectHeader
          initiative={initiative}
          onTitleUpdate={handleTitleUpdate}
          {...(activeView === 'plan' ? {
            leftToggle: rightPanelOpen ? {
              active: showChatPanel,
              onClick: handleToggleChatPanel,
              title: showChatPanel ? 'Hide chat panel' : 'Show chat panel',
            } : undefined,
            rightToggle: rightPanel === 'project_plan' ? {
              active: showInspector,
              disabled: !hasInspectorItem,
              onClick: handleToggleInspector,
              title: showInspector ? 'Hide inspector' : 'Show inspector',
            } : undefined,
          } : {
            onNewChat: !showChatLanding ? handleNewChat : undefined,
            onBack: !showChatLanding ? () => { setShowChatLanding(true); setShowEditorInChatView(false); } : undefined,
            rightToggle: !showChatLanding && chatEditorWidgets.length > 0 ? {
              active: showEditorInChatView,
              onClick: () => {
                setShowEditorInChatView((p) => !p);
                if (!showEditorInChatView) setShowChatInChatView(true);
              },
              title: showEditorInChatView ? 'Hide editor' : 'Show editor',
            } : undefined,
          })}
        />
      )}

      {/* Content row: sidebar + inset workspace */}
      <div className="flex flex-1 min-h-0">
        <SideDrawer
          variant="project"
          activeItem={activeView}
          onItemSelect={handleNavChange}
          materials={projectMaterials}
          onUploadMaterial={(file) => uploadMaterial(initiativeId, file)}
          onDeleteMaterial={deleteMaterial}
        />

        <div className="flex-1 p-2 pt-0 pl-1 min-h-0">
          <div className="h-full bg-surface rounded-lg shadow-workspace overflow-hidden">
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
            ) : activeView === 'chat' ? (
              <main ref={standaloneContainerRef} className="h-full min-w-0 flex overflow-hidden relative">
                <div
                  className="flex-shrink-0 relative overflow-hidden"
                  style={{ width: showEditorInChatView ? `${standaloneChatWidthPercent}%` : '100%' }}
                >
                  <ProjectStandaloneChatView
                    initiativeId={initiativeId}
                    showLanding={showChatLanding}
                    onMessageSent={() => setShowChatLanding(false)}
                    onBack={() => setShowChatLanding(true)}
                    onEditorWidgetsChange={handleChatEditorWidgetsChange}
                  />
                  {showEditorInChatView && (
                    <div
                      onMouseDown={(e) => { e.preventDefault(); setIsResizingStandalone(true); }}
                      className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/30 transition-colors ${isResizingStandalone ? 'bg-accent/50' : 'bg-transparent'}`}
                    />
                  )}
                </div>
                {showEditorInChatView && chatEditorWidgets.length > 0 && (
                  <div className="flex-1 overflow-hidden border-l border-divider">
                    <EditorSidePanel
                      widgets={chatEditorWidgets}
                      initiativeId={initiativeId}
                    />
                  </div>
                )}
              </main>
            ) : (
              <main ref={containerRef} className="h-full min-w-0 flex overflow-hidden relative">
                {uploadError && (
                  <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-2">
                    <div className="bg-indicator-orange/10 border border-indicator-orange/30 rounded px-4 py-3 shadow-lg max-w-md">
                      <p className="text-sm text-indicator-orange font-medium">{uploadError}</p>
                    </div>
                  </div>
                )}

                {rightPanelOpen ? (
                  <>
                    <div
                      className="flex-shrink-0 relative overflow-hidden"
                      style={{
                        width: showChatPanel ? `${chatWidthPercent}%` : 0,
                        transition: isResizing ? 'none' : 'width 300ms ease-in-out',
                      }}
                    >
                      <div className="absolute inset-0">
                        <ChatPanel
                          messages={messages}
                          sending={sending}
                          generating={generating}
                          initiativeId={initiativeId}
                          onSendMessage={handleSendMessage}
                          hasProjectPlan={hasProjectPlan}
                        />
                      </div>

                      {showChatPanel && (
                        <div
                          onMouseDown={handleResizeStart}
                          className={`
                            absolute top-0 right-0 w-1 h-full cursor-col-resize
                            hover:bg-accent/30 transition-colors
                            ${isResizing ? 'bg-accent/50' : 'bg-transparent'}
                          `}
                        />
                      )}
                    </div>

                    <div className="flex-1 overflow-hidden">
                      {showProjectPlan && (
                        <ProjectPlanView
                          initiativeId={initiativeId}
                          showInspector={showInspector}
                          onInspectorChange={handleInspectorChange}
                        />
                      )}
                      {showEditor && (
                        <EditorSidePanel
                          widgets={editorWidgets}
                          initiativeId={initiativeId}
                        />
                      )}
                    </div>
                  </>
                ) : (
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
                )}
              </main>
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
