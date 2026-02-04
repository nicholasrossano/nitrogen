'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { ProjectHeader, InputOutputBar, EditorPanel, ChatPanel } from '@/components/editor';
import { ProtectedRoute } from '@/components/ProtectedRoute';

const MIN_CHAT_WIDTH_PERCENT = 25;
const MAX_CHAT_WIDTH_PERCENT = 50;
const DEFAULT_CHAT_WIDTH_PERCENT = 50;

function InitiativePageContent() {
  const params = useParams();
  const initiativeId = params.id as string;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItemType, setSelectedItemType] = useState<'input' | 'output' | null>(null);
  const [chatWidthPercent, setChatWidthPercent] = useState(DEFAULT_CHAT_WIDTH_PERCENT);
  const [isResizing, setIsResizing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  
  const { 
    initiative, 
    messages,
    evidenceDocs,
    stageStatus,
    loading, 
    sending,
    generating,
    error, 
    loadInitiative, 
    loadChatHistory,
    loadEvidence,
    sendMessage,
    uploadEvidence,
    deleteEvidence,
    updateTitle,
  } = useInitiativeStore();

  useEffect(() => {
    if (initiativeId) {
      loadInitiative(initiativeId);
      loadChatHistory(initiativeId);
      loadEvidence(initiativeId);
    }
  }, [initiativeId, loadInitiative, loadChatHistory, loadEvidence]);

  // Auto-select most recent output when outputs are available
  useEffect(() => {
    if (initiative?.deliverables && !selectedItemId) {
      const outputs = Object.keys(initiative.deliverables);
      if (outputs.length > 0) {
        // Select the last output (most recent)
        const mostRecentOutput = outputs[outputs.length - 1];
        setSelectedItemId(mostRecentOutput);
        setSelectedItemType('output');
      }
    }
  }, [initiative?.deliverables]);

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

  const handleSelectItem = (id: string, type: 'input' | 'output') => {
    // If clicking the same item, deselect it
    if (selectedItemId === id && selectedItemType === type) {
      setSelectedItemId(null);
      setSelectedItemType(null);
    } else {
      setSelectedItemId(id);
      setSelectedItemType(type);
    }
  };

  const handleUploadEvidence = async (file: File) => {
    try {
      setUploadError(null);
      await uploadEvidence(initiativeId, file);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload document';
      setUploadError(message);
      // Clear error after 5 seconds
      setTimeout(() => setUploadError(null), 5000);
    }
  };

  const handleDeleteEvidence = async (evidenceId: string) => {
    try {
      await deleteEvidence(evidenceId);
      // If the deleted doc was selected, deselect it
      if (selectedItemId === evidenceId) {
        setSelectedItemId(null);
        setSelectedItemType(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete document';
      setUploadError(message);
      setTimeout(() => setUploadError(null), 5000);
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
    // Only show error page if there's no initiative and there's an error
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

  // Check if there are any outputs
  const hasOutputs = initiative.deliverables && Object.keys(initiative.deliverables).length > 0;
  
  // Determine if editor should be shown
  // Show editor if: there are outputs OR an input document is selected
  const shouldShowEditor = hasOutputs || (selectedItemType === 'input' && selectedItemId !== null);

  // Check if we've passed the document request stage
  // Look for messages that indicate we're past the initial document upload question
  const hasPassedDocumentRequest = messages.some(msg => 
    msg.role === 'user' && (
      msg.content.toLowerCase().includes("don't have any documents") ||
      msg.content.toLowerCase().includes("uploaded my documents") ||
      msg.content.toLowerCase().includes("no documents")
    )
  );
  
  // Check if tool selection widget has appeared (indicates we're past document stage)
  const hasToolSelectionWidget = messages.some(msg => 
    msg.widget_type === 'tool_checklist' || msg.widget_type === 'deliverables_list'
  );
  
  // Only show InputOutputBar after initial project description (describe stage)
  // Show if:
  // 1. stage_1_complete is true, OR
  // 2. We're past the describe stage, OR
  // 3. Tools have been selected, OR
  // 4. User has responded to document request, OR
  // 5. Tool selection widget is showing
  const shouldShowInputOutputBar = 
    stageStatus?.stage_1_complete === true ||
    (stageStatus?.stage && stageStatus.stage !== 'describe' && stageStatus.stage !== 'intake') ||
    (initiative?.selected_tools && initiative.selected_tools.length > 0) ||
    hasPassedDocumentRequest ||
    hasToolSelectionWidget;

  // Debug: log the stage status
  console.log('🔍 InputOutputBar Debug:', {
    stageStatus,
    stage: stageStatus?.stage,
    stage_1_complete: stageStatus?.stage_1_complete,
    shouldShowInputOutputBar,
    evidenceDocsCount: evidenceDocs.length,
  });

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
      />

      {/* Input/Output Bar - only show after intake stage */}
      {shouldShowInputOutputBar && (
        <InputOutputBar
          initiative={initiative}
          evidenceDocs={evidenceDocs}
          selectedItemId={selectedItemId}
          onSelectItem={handleSelectItem}
          onUploadEvidence={handleUploadEvidence}
          onDeleteEvidence={handleDeleteEvidence}
          loading={loading}
        />
      )}

      {/* Main content: Chat + Editor split (or just Chat if no outputs) */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden relative">
        {shouldShowEditor ? (
          <>
            {/* Chat Panel - Left side (resizable) */}
            <div 
              className="flex-shrink-0 relative"
              style={{ width: `${chatWidthPercent}%` }}
            >
              <ChatPanel
                messages={messages}
                sending={sending}
                generating={generating}
                initiativeId={initiativeId}
                onSendMessage={handleSendMessage}
              />
              
              {/* Resize handle */}
              <div
                onMouseDown={handleResizeStart}
                className={`
                  absolute top-0 right-0 w-1 h-full cursor-col-resize
                  hover:bg-accent/30 transition-colors
                  ${isResizing ? 'bg-accent/50' : 'bg-transparent'}
                `}
              />
            </div>

            {/* Editor Panel - Right side */}
            <div className="flex-1 overflow-hidden">
              <EditorPanel
                initiative={initiative}
                selectedItemId={selectedItemId}
                selectedItemType={selectedItemType}
                evidenceDocs={evidenceDocs}
                onUploadClick={() => fileInputRef.current?.click()}
                onDeleteEvidence={handleDeleteEvidence}
              />
            </div>
          </>
        ) : (
          /* No outputs - full width chat */
          <div className="flex-1 overflow-hidden h-full">
            <ChatPanel
              messages={messages}
              sending={sending}
              generating={generating}
              initiativeId={initiativeId}
              onSendMessage={handleSendMessage}
              fullWidth={true}
            />
          </div>
        )}
      </div>

      {/* Hidden file input for upload button in EditorPanel */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) {
            await handleUploadEvidence(file);
            e.target.value = '';
          }
        }}
        className="hidden"
      />
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
