'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useChatStore } from '@/stores/chatStore';
import { SideDrawer, SideDrawerHeader, NavItem } from '@/components/ui';
import { PanelLeft, PanelRight, SquarePen } from 'lucide-react';
import { LandingInput } from '@/components/core-chat/LandingInput';
import { ConversationView } from '@/components/core-chat/ConversationView';
import { EditorSidePanel, EDITOR_WIDGET_TYPES, WIDGET_MODEL_GROUP } from '@/components/editor';
import type { EditorWidget } from '@/components/editor';
import { useAuth } from '@/lib/auth';
import { track } from '@/lib/analytics';

const EDITOR_DEFAULT_WIDTH = 480;
const EDITOR_MIN_PCT = 0.30;
const EDITOR_MAX_PCT = 0.70;

function ChatPageContent() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { phase, messages, sendMessage, reset } = useChatStore();
  const [showSidebar, setShowSidebar] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editorWidth, setEditorWidth] = useState(EDITOR_DEFAULT_WIDTH);
  const editorPanelRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = editorWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [editorWidth]);

  useEffect(() => {
    const clamp = (v: number) => {
      const minW = window.innerWidth * EDITOR_MIN_PCT;
      const maxW = window.innerWidth * EDITOR_MAX_PCT;
      return Math.round(Math.min(maxW, Math.max(minW, v)));
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = dragStartXRef.current - e.clientX;
      const w = clamp(dragStartWidthRef.current + delta);
      // Update DOM directly — no React re-render during drag
      if (editorPanelRef.current) {
        editorPanelRef.current.style.width = `${w}px`;
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Commit final width to React state once
      const delta = dragStartXRef.current - e.clientX;
      setEditorWidth(clamp(dragStartWidthRef.current + delta));
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const editorWidgets: EditorWidget[] = useMemo(() => {
    const all = messages
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
      }));

    const byModel = new Map<string, EditorWidget>();
    for (const w of all) {
      const group = WIDGET_MODEL_GROUP[w.type];
      if (group) byModel.set(group, w);
    }
    return Array.from(byModel.values());
  }, [messages]);

  const hasEditorContent = editorWidgets.length > 0;

  // Auto-open editor when first widget arrives
  const prevHadContent = useRef(false);
  useEffect(() => {
    if (hasEditorContent && !prevHadContent.current) {
      setShowEditor(true);
    }
    prevHadContent.current = hasEditorContent;
  }, [hasEditorContent]);

  // Close editor when content disappears (e.g. new chat)
  useEffect(() => {
    if (!hasEditorContent) setShowEditor(false);
  }, [hasEditorContent]);

  useEffect(() => {
    track('chat_page_viewed');
  }, []);

  const handleNavChange = (item: NavItem) => {
    if (item === 'chat') {
      reset();
    } else if (item === 'projects' || item === 'trash') {
      router.push('/');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  return (
    <div className="min-h-screen h-screen flex flex-col overflow-hidden">
      {/* Shared header row */}
      <div className="flex shrink-0">
        <div className={`overflow-hidden transition-[width] duration-300 ease-in-out bg-white ${showSidebar ? 'w-44 border-r-1 border-accent' : 'w-0'}`}>
          <SideDrawerHeader />
        </div>
        <header className="flex-1 px-4 py-[7px] flex items-center justify-between bg-white">
          {/* Left: panel toggles */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSidebar(p => !p)}
              title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
              className={`icon-btn p-1.5 ${showSidebar ? 'text-accent' : 'text-text-tertiary'}`}
            >
              <PanelLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowEditor(p => !p)}
              title={showEditor ? 'Hide editor' : 'Show editor'}
              disabled={!hasEditorContent}
              className={`icon-btn p-1.5 ${showEditor && hasEditorContent ? 'text-accent' : 'text-text-tertiary'} ${!hasEditorContent ? 'opacity-30 cursor-not-allowed' : ''}`}
            >
              <PanelRight className="w-4 h-4" />
            </button>
          </div>
          {/* Right: actions */}
          <button
            onClick={reset}
            title="New chat"
            disabled={phase !== 'conversation'}
            className={`icon-btn p-1.5 transition-opacity ${phase === 'conversation' ? 'text-text-tertiary' : 'opacity-30 cursor-not-allowed text-text-tertiary'}`}
          >
            <SquarePen className="w-4 h-4" />
          </button>
        </header>
      </div>
      <div className="divider-accent shrink-0" />

      {/* Content row: sidebar + main + editor */}
      <div className="flex flex-1 min-h-0">
      <div className={`overflow-hidden transition-[width] duration-300 ease-in-out flex-shrink-0 bg-white ${showSidebar ? 'w-44 border-r-1 border-accent' : 'w-0'}`}>
        <SideDrawer
          activeItem="chat"
          onItemSelect={handleNavChange}
          includeHeader={false}
          onSignOut={handleSignOut}
          userEmail={user?.email}
        />
      </div>

      <main className="flex-1 bg-white min-h-0 relative overflow-hidden">
          {/* Landing state */}
          <div
            className={`absolute inset-0 flex transition-all duration-300 ease-out ${
              phase === 'conversation'
                ? 'opacity-0 pointer-events-none -translate-y-4'
                : 'opacity-100 translate-y-0'
            }`}
          >
            <LandingInput onSend={sendMessage} />
          </div>

          {/* Conversation state */}
          <div
            className={`absolute inset-0 flex flex-col transition-all duration-300 ease-out ${
              phase === 'landing'
                ? 'opacity-0 pointer-events-none translate-y-4'
                : 'opacity-100 translate-y-0'
            }`}
          >
            <ConversationView />
          </div>
      </main>

      {/* Editor side panel */}
      {showEditor && hasEditorContent && (
        <div
          ref={editorPanelRef}
          className="flex-shrink-0 border-l border-divider overflow-hidden relative"
          style={{ width: editorWidth }}
        >
          {/* Drag handle overlaid on the border — invisible until hover */}
          <div
            onMouseDown={handleDragStart}
            className="absolute left-0 top-0 w-1 h-full cursor-col-resize hover:bg-accent/20 transition-colors z-10"
            title="Drag to resize"
          />
          <div className="h-full w-full">
            <EditorSidePanel widgets={editorWidgets} />
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <ProtectedRoute>
      <ChatPageContent />
    </ProtectedRoute>
  );
}
