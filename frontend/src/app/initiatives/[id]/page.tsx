'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { ProjectHeader, ChatPanel, EditorSidePanel, EDITOR_WIDGET_TYPES } from '@/components/editor';
import type { EditorWidget, RightPanelMode } from '@/components/editor';
import { ProjectPlanView } from '@/components/project-plan';
import { ProtectedRoute } from '@/components/ProtectedRoute';

const MIN_CHAT_WIDTH_PERCENT = 20;
const MAX_CHAT_WIDTH_PERCENT = 40;
const DEFAULT_CHAT_WIDTH_PERCENT = 30;

function InitiativePageContent() {
  const params = useParams();
  const initiativeId = params.id as string;
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [chatWidthPercent, setChatWidthPercent] = useState(DEFAULT_CHAT_WIDTH_PERCENT);
  const [isResizing, setIsResizing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<RightPanelMode>('closed');
  const [showChatPanel, setShowChatPanel] = useState(true);
  const [showInspector, setShowInspector] = useState(false);
  const [hasInspectorItem, setHasInspectorItem] = useState(false);
  
  const { 
    initiative, 
    messages,
    projectPlan,
    loading, 
    sending,
    generating,
    error, 
    loadInitiative, 
    loadChatHistory,
    loadEvidence,
    loadProjectPlan,
    sendMessage,
    updateTitle,
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
      loadProjectPlan(initiativeId);
    }
  }, [initiativeId, loadInitiative, loadChatHistory, loadEvidence, loadProjectPlan]);

  // Auto-open project plan when it first becomes available
  const prevPlanRef = useRef<boolean>(false);
  useEffect(() => {
    const hasPlan = !!projectPlan;
    if (hasPlan && !prevPlanRef.current) {
      setRightPanel('project_plan');
    }
    prevPlanRef.current = hasPlan;
  }, [projectPlan]);

  // Auto-open editor when first widget arrives (only if panel is closed)
  const prevHadEditor = useRef(false);
  useEffect(() => {
    if (hasEditorContent && !prevHadEditor.current && rightPanel === 'closed') {
      setRightPanel('editor');
    }
    prevHadEditor.current = hasEditorContent;
  }, [hasEditorContent, rightPanel]);

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

  const handleToggleRightPanel = () => {
    setRightPanel((prev) => {
      if (prev === 'closed') {
        setShowChatPanel(true);
        return hasProjectPlan ? 'project_plan' : 'editor';
      }
      if (prev === 'project_plan') {
        if (hasEditorContent) return 'editor';
        return 'closed';
      }
      // prev === 'editor'
      if (hasProjectPlan) return 'project_plan';
      return 'closed';
    });
  };

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

  if (loading && !initiative) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
          <span className="text-sm text-text-secondary">Loading project...</span>
        </div>
      </div>
    );
  }

  if (!initiative) {
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-white">
          <div className="card p-8 text-center max-w-md">
            <p className="text-indicator-orange mb-4">{error}</p>
            <Link 
              href="/" 
              className="btn-secondary inline-flex"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to projects
            </Link>
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="flex flex-col h-screen bg-white overflow-hidden">
      {/* Upload Error Toast */}
      {uploadError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-2">
          <div className="bg-indicator-orange/10 border border-indicator-orange/30 rounded px-4 py-3 shadow-lg max-w-md">
            <p className="text-sm text-indicator-orange font-medium">{uploadError}</p>
          </div>
        </div>
      )}

      {/* Project Header */}
      <ProjectHeader 
        initiative={initiative} 
        onTitleUpdate={handleTitleUpdate}
        rightPanel={rightPanel}
        onToggleRightPanel={handleToggleRightPanel}
        hasProjectPlan={hasProjectPlan}
        hasEditorContent={hasEditorContent}
        showChatPanel={showChatPanel}
        onToggleChatPanel={handleToggleChatPanel}
        showInspector={showInspector}
        hasInspectorItem={hasInspectorItem}
        onToggleInspector={handleToggleInspector}
      />

      {/* Main content area */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden relative">
        {rightPanelOpen ? (
          <>
            {/* Chat Panel - Left side (resizable, collapsible) */}
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

              {/* Resize handle */}
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

            {/* Right side: Project Plan or Editor */}
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
          /* Full-width chat */
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
