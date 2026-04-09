'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import type { ChatMessage, ResearchStep, SourceCitation } from '@/lib/api';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { filterSupportedFiles } from '@/lib/fileUtils';
import { ConversationView } from './ConversationView';
import { LandingInput } from './LandingInput';
import { CompareProjectPicker, CompareChip } from './CompareProjectPicker';
import type { CompareProject } from './CompareProjectPicker';
import { EDITOR_WIDGET_TYPES } from '@/components/editor/EditorSidePanel';
import type { EditorWidget } from '@/components/editor/EditorSidePanel';
import type { CoreChatMessage, ChatSession } from '@/stores/chatStore';

const DELIVERABLE_WIDGET_TYPES = ['memo_viewer', 'checklist_viewer'];

interface ProjectStandaloneChatViewProps {
  initiativeId: string;
  showLanding?: boolean;
  /** When true, hides the module tile grid on the landing page (Research mode) */
  hideTiles?: boolean;
  /** When false, empty state stays in conversation mode instead of showing the landing UI */
  useLandingWhenEmpty?: boolean;
  initialSessionId?: string | null;
  initialTitle?: string | null;
  onMessageSent?: () => void;
  onBack?: () => void;
  /** Called whenever the set of editor widgets in local messages changes */
  onEditorWidgetsChange?: (widgets: EditorWidget[]) => void;
  /** Called when user clicks an internal citation */
  onCitationClick?: (citation: SourceCitation) => void;
  /** Called when the active thread/session metadata changes */
  onSessionMetaChange?: (meta: { sessionId: string | null; title: string | null }) => void;
  /** Called when this view enters or leaves its landing state */
  onLandingStateChange?: (isOnLanding: boolean) => void;
  /** Ref that the parent can call to programmatically trigger a send (e.g. from ModuleLandingPage) */
  onSendRef?: React.MutableRefObject<((content: string, toolHint?: string) => void) | null>;
}

function toCoreMessage(m: ChatMessage): CoreChatMessage {
  return {
    id: m.id,
    role: m.role as 'user' | 'assistant',
    content: m.content,
    sources: m.sources ?? null,
    thinkingLines: m.thinking_lines ?? undefined,
    completionMeta: m.completion_meta
      ? {
          latency_ms: m.completion_meta.latency_ms ?? 0,
          citation_count: m.completion_meta.citation_count,
          tiers_used: m.completion_meta.tiers_used,
        }
      : undefined,
    widget_type: m.widget_type,
    widget_data: m.widget_data,
  };
}

export function ProjectStandaloneChatView({
  initiativeId,
  showLanding = false,
  hideTiles = false,
  useLandingWhenEmpty = true,
  initialSessionId = null,
  initialTitle = null,
  onMessageSent,
  onBack,
  onEditorWidgetsChange,
  onCitationClick,
  onSessionMetaChange,
  onLandingStateChange,
  onSendRef,
}: ProjectStandaloneChatViewProps) {
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [thinkingLines, setThinkingLines] = useState<string[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [researchSteps, setResearchSteps] = useState<ResearchStep[]>([]);
  const [messageFeedback, setFeedbackMap] = useState<
    Record<string, 'like' | 'dislike' | null>
  >({});
  const [dbSessions, setDbSessions] = useState<ChatSession[]>([]);
  const [compareProject, setCompareProject] = useState<CompareProject | null>(null);
  const lastReportedMetaRef = useRef<{ sessionId: string | null; title: string | null } | null>(null);

  const uploadMaterial = useInitiativeStore((s) => s.uploadMaterial);

  useEffect(() => {
    if (initialTitle && !sessionTitle) {
      setSessionTitle(initialTitle);
    }
  }, [initialTitle, sessionTitle]);

  // Load session list from DB on mount — scoped to this project
  useEffect(() => {
    api.getChatSessions(initiativeId)
      .then(({ sessions }) => {
        setDbSessions(
          sessions.map((s) => ({
            id: s.id,
            title: s.title || 'Untitled',
            createdAt: s.created_at ? new Date(s.created_at).getTime() : Date.now(),
            messages: [],
          })),
        );
      })
      .catch((err) => console.warn('Failed to load chat sessions:', err));
  }, [initiativeId]);

  useEffect(() => {
    if (!initialSessionId) return;
    if (currentSessionId === initialSessionId || localMessages.length > 0) return;

    let cancelled = false;
    api.getChatSessionMessages(initialSessionId)
      .then(({ messages, title }) => {
        if (cancelled) return;
        setLocalMessages(messages);
        setSessionTitle(title || initialTitle || 'Untitled');
        setCurrentSessionId(initialSessionId);
        setFeedbackMap(
          Object.fromEntries(
            messages.filter((m) => m.feedback).map((m) => [m.id, m.feedback!]),
          ) as Record<string, 'like' | 'dislike' | null>,
        );
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to load initial session messages:', err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialSessionId, initialTitle, currentSessionId, localMessages.length]);

  useEffect(() => {
    const nextMeta = {
      sessionId: currentSessionId,
      title: sessionTitle,
    };
    const prevMeta = lastReportedMetaRef.current;
    if (
      prevMeta?.sessionId === nextMeta.sessionId &&
      prevMeta?.title === nextMeta.title
    ) {
      return;
    }
    lastReportedMetaRef.current = nextMeta;
    onSessionMetaChange?.(nextMeta);
  }, [currentSessionId, sessionTitle, onSessionMetaChange]);

  // When showLanding transitions to true, clear current conversation
  // (it's already persisted to DB by the streaming endpoint)
  const prevShowLanding = useRef(showLanding);
  useEffect(() => {
    if (showLanding && !prevShowLanding.current && localMessages.length > 0) {
      // Refresh sessions list so the just-finished conversation appears in history
      api.getChatSessions(initiativeId)
        .then(({ sessions }) => {
          setDbSessions(
            sessions.map((s) => ({
              id: s.id,
              title: s.title || 'Untitled',
              createdAt: s.created_at ? new Date(s.created_at).getTime() : Date.now(),
              messages: [],
            })),
          );
        })
        .catch(() => {});
      setLocalMessages([]);
      setSessionTitle(null);
      setCurrentSessionId(null);
      setFeedbackMap({});
      setCompareProject(null);
    }
    prevShowLanding.current = showLanding;
  }, [showLanding, localMessages, initiativeId]);

  // Persist the AI-generated title to the DB session once both are available
  const titlePersistedRef = useRef(false);
  useEffect(() => {
    if (sessionTitle && currentSessionId && !titlePersistedRef.current) {
      titlePersistedRef.current = true;
      api.updateChatSessionTitle(currentSessionId, sessionTitle).catch(() => {});
    }
    if (!currentSessionId) titlePersistedRef.current = false;
  }, [sessionTitle, currentSessionId]);

  // Notify parent about editor widgets whenever local messages change
  useEffect(() => {
    if (!onEditorWidgetsChange) return;
    const raw: EditorWidget[] = localMessages
      .filter(
        (m) =>
          m.widget_type &&
          m.widget_data &&
          (EDITOR_WIDGET_TYPES as readonly string[]).includes(m.widget_type),
      )
      .map((m) => ({ type: m.widget_type!, data: m.widget_data!, messageId: m.id }));

    onEditorWidgetsChange(raw);
  }, [localMessages, onEditorWidgetsChange]);

  const displayMessages = useMemo(
    () => localMessages.map(toCoreMessage),
    [localMessages],
  );

  const sessions = dbSessions;

  const sendViaStream = useCallback(
    async (content: string, currentMessages: ChatMessage[], toolHint?: string) => {
      const history = currentMessages.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const words: string[] = [];
      setThinkingLines([]);
      setStreamingContent('');
      setError(null);
      setResearchSteps([]);

      const compareIds = compareProject
        ? [initiativeId, compareProject.id]
        : null;

      await api.sendChatStream(
        history,
        content,
        (text) => setThinkingLines((prev) => [...prev, text]),
        (word) => {
          words.push(word);
          setStreamingContent(words.join(' '));
        },
        (payload) => {
          setStreamingContent('');
          setThinkingLines([]);

          if (payload.session_id) {
            setCurrentSessionId(payload.session_id);
          }

          setLocalMessages((prev) =>
            prev.map((m) =>
              m.id.startsWith('user-') && m.role === 'user' && !prev.find((x) => x.id === payload.user_message_id)
                ? { ...m, id: payload.user_message_id }
                : m,
            ),
          );

          const assistantMsg: ChatMessage = {
            id: payload.assistant_message_id,
            role: 'assistant',
            content: payload.content,
            sources: payload.sources ?? null,
            thinking_lines: payload.thinking_lines,
            completion_meta: {
              latency_ms: payload.latency_ms,
              citation_count: payload.citation_count,
              tiers_used: payload.tiers_used,
            },
            widget_type: payload.widget_type ?? null,
            widget_data: payload.widget_data ?? null,
            created_at: new Date().toISOString(),
          };
          setLocalMessages((prev) => [...prev, assistantMsg]);
          setSending(false);
        },
        (message) => {
          setStreamingContent('');
          setThinkingLines([]);
          setError(message);
          setSending(false);
        },
        currentSessionId,
        toolHint ?? null,
        null,
        initiativeId,
        (step) => {
          setResearchSteps((prev) => {
            const idx = prev.findIndex((s) => s.id === step.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = step;
              return updated;
            }
            return [...prev, step];
          });
        },
        compareIds,
      );
    },
    [initiativeId, currentSessionId, compareProject],
  );

  const handleUploadFile = useCallback(
    async (file: File) => {
      const { accepted } = filterSupportedFiles([file]);
      if (accepted.length === 0) return;
      await uploadMaterial(initiativeId, file);
    },
    [initiativeId, uploadMaterial],
  );

  const handleSend = useCallback(
    async (content: string, toolHint?: string) => {
      onMessageSent?.();

      const isFirst = localMessages.length === 0;

      if (isFirst) {
        api
          .generateChatTitle(content)
          .then(({ title }) => {
            if (title) setSessionTitle(title);
          })
          .catch(() => {});
      }

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        widget_type: null,
        widget_data: null,
        created_at: new Date().toISOString(),
      };

      const updatedMessages = [...localMessages, userMsg];
      setLocalMessages(updatedMessages);
      setSending(true);

      try {
        await sendViaStream(content, updatedMessages, toolHint);
      } catch {
        setLocalMessages((prev) =>
          prev.filter((m) => m.id !== userMsg.id),
        );
        setSending(false);
      }
    },
    [localMessages, onMessageSent, sendViaStream],
  );

  const handleEditMessage = useCallback(
    async (messageId: string, newContent: string) => {
      const idx = localMessages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      const truncated = localMessages.slice(0, idx);

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: newContent,
        widget_type: null,
        widget_data: null,
        created_at: new Date().toISOString(),
      };

      const updatedMessages = [...truncated, userMsg];
      setLocalMessages(updatedMessages);
      setSending(true);

      try {
        await sendViaStream(newContent, updatedMessages);
      } catch {
        setLocalMessages(truncated);
        setSending(false);
      }
    },
    [localMessages, sendViaStream],
  );

  const handleRetryMessage = useCallback(
    async (messageId: string) => {
      const idx = localMessages.findIndex((m) => m.id === messageId);
      if (idx === -1 || localMessages[idx].role !== 'assistant') return;

      const preceding = localMessages.slice(0, idx);
      const lastUserMsg = [...preceding].reverse().find((m) => m.role === 'user');
      if (!lastUserMsg) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: lastUserMsg.content,
        widget_type: null,
        widget_data: null,
        created_at: new Date().toISOString(),
      };

      const updatedMessages = [...preceding, userMsg];
      setLocalMessages(updatedMessages);
      setSending(true);

      try {
        await sendViaStream(lastUserMsg.content, updatedMessages);
      } catch {
        setLocalMessages(preceding);
        setSending(false);
      }
    },
    [localMessages, sendViaStream],
  );

  const handleSetFeedback = useCallback(
    (messageId: string, feedback: 'like' | 'dislike' | null) => {
      setFeedbackMap((prev) => ({ ...prev, [messageId]: feedback }));
    },
    [],
  );

  const handleLoadSession = useCallback(
    async (session: ChatSession) => {
      try {
        const { messages, title } = await api.getChatSessionMessages(session.id);
        setLocalMessages(messages);
        setSessionTitle(title || session.title);
        setCurrentSessionId(session.id);
        setFeedbackMap(
          Object.fromEntries(
            messages.filter((m) => m.feedback).map((m) => [m.id, m.feedback!]),
          ) as Record<string, 'like' | 'dislike' | null>,
        );
        onMessageSent?.();
      } catch (err) {
        console.error('Failed to load session messages:', err);
      }
    },
    [onMessageSent],
  );

  const handleDeleteSession = useCallback(
    (id: string) => {
      setDbSessions((prev) => prev.filter((s) => s.id !== id));
      api.deleteChatSession(id).catch((err) => {
        console.error('Failed to delete session:', err);
      });
    },
    [],
  );

  // Expose handleSend to parent via ref so ModuleLandingPage can trigger a send
  useEffect(() => {
    if (onSendRef) onSendRef.current = handleSend;
    return () => {
      if (onSendRef) onSendRef.current = null;
    };
  }, [onSendRef, handleSend]);

  const isOnLanding = showLanding || (useLandingWhenEmpty && localMessages.length === 0);

  useEffect(() => {
    onLandingStateChange?.(isOnLanding);
  }, [isOnLanding, onLandingStateChange]);

  if (isOnLanding) {
    return (
      <>
        <LandingInput
          onSend={handleSend}
          onUploadFile={handleUploadFile}
          sessions={sessions}
          onLoadSession={handleLoadSession}
          onDeleteSession={handleDeleteSession}
          hideTiles={hideTiles}
          headerContent={hideTiles ? (
            <div className="text-center mb-8">
              <div className="flex items-center justify-center gap-2.5 mb-3">
                <Search className="w-7 h-7 text-accent" strokeWidth={1.75} />
                <h1 className="text-[32px] font-semibold text-text-primary tracking-tight font-display">Research</h1>
              </div>
              <p className="text-sm text-text-tertiary leading-relaxed max-w-md mx-auto">
                Research and analyze project materials, compare against another project, or ask about past academic work and case studies.
              </p>
            </div>
          ) : undefined}
          extraInputActions={hideTiles ? (
            <CompareProjectPicker
              currentProjectId={initiativeId}
              selected={compareProject}
              onSelect={setCompareProject}
            />
          ) : undefined}
          inputChips={compareProject ? (
            <CompareChip project={compareProject} onRemove={() => setCompareProject(null)} />
          ) : undefined}
        />
      </>
    );
  }

  return (
    <ConversationView
      messages={displayMessages}
      sending={sending}
      thinkingLines={thinkingLines}
      researchSteps={researchSteps}
      streamingContent={streamingContent}
      error={error}
      onSendMessage={handleSend}
      onUploadFile={handleUploadFile}
      onEditMessage={handleEditMessage}
      onRetryMessage={handleRetryMessage}
      messageFeedback={messageFeedback}
      onSetFeedback={handleSetFeedback}
      retryingMessageId={null}
      onBack={onBack}
      title={sessionTitle}
      initiativeId={initiativeId}
      onCitationClick={onCitationClick}
      extraInputActions={hideTiles ? (
        <CompareProjectPicker
          currentProjectId={initiativeId}
          selected={compareProject}
          onSelect={setCompareProject}
        />
      ) : undefined}
      inputChips={compareProject ? (
        <CompareChip project={compareProject} onRemove={() => setCompareProject(null)} />
      ) : undefined}
    />
  );
}
