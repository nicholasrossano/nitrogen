'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { ProjectHeader, InputOutputBar, EditorPanel, ChatPanel } from '@/components/editor';

const MIN_CHAT_WIDTH_PERCENT = 20;
const MAX_CHAT_WIDTH_PERCENT = 50;
const DEFAULT_CHAT_WIDTH_PERCENT = 30;

export default function InitiativePage() {
  const params = useParams();
  const initiativeId = params.id as string;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItemType, setSelectedItemType] = useState<'input' | 'output' | null>(null);
  const [chatWidthPercent, setChatWidthPercent] = useState(DEFAULT_CHAT_WIDTH_PERCENT);
  const [isResizing, setIsResizing] = useState(false);
  
  const { 
    initiative, 
    messages,
    evidenceDocs,
    loading, 
    sending,
    generating,
    error, 
    loadInitiative, 
    loadChatHistory,
    loadEvidence,
    sendMessage,
    uploadEvidence,
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
    if (initiative?.deliverables) {
      const outputs = Object.keys(initiative.deliverables);
      if (outputs.length > 0 && !selectedItemId) {
        // Select the last output (most recent)
        const mostRecentOutput = outputs[outputs.length - 1];
        setSelectedItemId(mostRecentOutput);
        setSelectedItemType('output');
      }
    }
  }, [initiative?.deliverables, selectedItemId]);

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
    setSelectedItemId(id);
    setSelectedItemType(type);
  };

  const handleUploadEvidence = async (file: File) => {
    await uploadEvidence(initiativeId, file);
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

  if (!initiative) {
    return null;
  }

  // Check if there are any outputs
  const hasOutputs = initiative.deliverables && Object.keys(initiative.deliverables).length > 0;

  return (
    <div className="flex flex-col h-screen bg-white overflow-hidden">
      {/* Project Header */}
      <ProjectHeader 
        initiative={initiative} 
        onTitleUpdate={handleTitleUpdate}
      />

      {/* Input/Output Bar */}
      <InputOutputBar
        initiative={initiative}
        evidenceDocs={evidenceDocs}
        selectedItemId={selectedItemId}
        onSelectItem={handleSelectItem}
        onUploadEvidence={handleUploadEvidence}
        loading={loading}
      />

      {/* Main content: Chat + Editor split (or just Chat if no outputs) */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden relative">
        {hasOutputs ? (
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
            <div className="flex-1 bg-surface-subtle overflow-hidden">
              <EditorPanel
                initiative={initiative}
                selectedItemId={selectedItemId}
                selectedItemType={selectedItemType}
                evidenceDocs={evidenceDocs}
                onUploadClick={() => fileInputRef.current?.click()}
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
