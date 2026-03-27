'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import type { ChatMessage, ResearchStep, SourceCitation } from '@/lib/api';
import { ConversationView } from './ConversationView';
import { LandingInput } from './LandingInput';
import type { CoreChatMessage } from '@/stores/chatStore';

const COMPARE_SUGGESTED_PROMPTS = [
  'Summarize the key differences between these projects',
  'Which project appears more implementation-ready?',
  'Compare their risks and assumptions',
  'Which project has the stronger evidence base?',
  'What information is missing to make a decision between them?',
  'Which project is a better fit for funding?',
];

interface CompareStandaloneChatViewProps {
  compareInitiativeIds: [string, string];
  titleA: string;
  titleB: string;
  onCitationClick?: (citation: SourceCitation) => void;
  onBack?: () => void;
  /** Fires when the component transitions between landing and conversation */
  onLandingChange?: (isLanding: boolean) => void;
  /** If provided, load this session on mount instead of showing the landing */
  initialSessionId?: string | null;
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

export function CompareStandaloneChatView({
  compareInitiativeIds,
  titleA,
  titleB,
  onCitationClick,
  onBack,
  onLandingChange,
  initialSessionId,
}: CompareStandaloneChatViewProps) {
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
  const [showLanding, setShowLanding] = useState(!initialSessionId);

  // Load initial session if provided
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!initialSessionId || loadedRef.current) return;
    loadedRef.current = true;
    api.getChatSessionMessages(initialSessionId)
      .then(({ messages, title }) => {
        setLocalMessages(messages);
        setSessionTitle(title || `${titleA} vs ${titleB}`);
        setCurrentSessionId(initialSessionId);
        setFeedbackMap(
          Object.fromEntries(
            messages.filter((m) => m.feedback).map((m) => [m.id, m.feedback!]),
          ) as Record<string, 'like' | 'dislike' | null>,
        );
        setShowLanding(false);
      })
      .catch((err) => console.error('Failed to load session:', err));
  }, [initialSessionId, titleA, titleB]);

  const titlePersistedRef = useRef(false);
  useEffect(() => {
    if (sessionTitle && currentSessionId && !titlePersistedRef.current) {
      titlePersistedRef.current = true;
      api.updateChatSessionTitle(currentSessionId, sessionTitle).catch(() => {});
    }
    if (!currentSessionId) titlePersistedRef.current = false;
  }, [sessionTitle, currentSessionId]);

  const displayMessages = useMemo(
    () => localMessages.map(toCoreMessage),
    [localMessages],
  );

  const sendViaStream = useCallback(
    async (content: string, currentMessages: ChatMessage[]) => {
      const history = currentMessages.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const words: string[] = [];
      setThinkingLines([]);
      setStreamingContent('');
      setError(null);
      setResearchSteps([]);

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
        null,
        null,
        null,
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
        compareInitiativeIds,
      );
    },
    [compareInitiativeIds, currentSessionId],
  );

  const handleSend = useCallback(
    async (content: string) => {
      setShowLanding(false);
      const isFirst = localMessages.length === 0;

      if (isFirst) {
        api.generateChatTitle(content)
          .then(({ title }) => { if (title) setSessionTitle(title); })
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
        await sendViaStream(content, updatedMessages);
      } catch {
        setLocalMessages((prev) =>
          prev.filter((m) => m.id !== userMsg.id),
        );
        setSending(false);
      }
    },
    [localMessages, sendViaStream],
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

  const isOnLanding = showLanding && localMessages.length === 0;

  useEffect(() => {
    onLandingChange?.(isOnLanding);
  }, [isOnLanding, onLandingChange]);

  const chatHeader = (
    <div className="relative flex items-center px-4 py-3 border-b border-divider flex-shrink-0">
      {onBack && (
        <button
          onClick={onBack}
          className="p-1 rounded hover:bg-surface-subtle transition-colors text-text-tertiary hover:text-text-secondary flex-shrink-0"
          title="Back to project selection"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
      )}
      <h3 className="absolute inset-x-0 text-center text-sm font-medium text-text-primary truncate px-10 pointer-events-none">
        {titleA} vs {titleB}
      </h3>
    </div>
  );

  if (isOnLanding) {
    const headerContent = (
      <div className="w-full flex flex-col items-center gap-8 mb-8">
        <div className="w-full grid grid-cols-2 gap-2">
          {COMPARE_SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => handleSend(prompt)}
              className="text-left px-3 py-2.5 rounded-lg border border-stroke-subtle bg-surface text-xs text-text-secondary enabled:hover:bg-surface-subtle enabled:hover:border-accent/30 enabled:hover:text-text-primary transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    );

    return (
      <div className="flex flex-col h-full">
        {chatHeader}
        <div className="flex-1 min-h-0">
          <LandingInput
            onSend={handleSend}
            hideTiles
            headerContent={headerContent}
            placeholder="Ask a comparison question..."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {chatHeader}
      <div className="flex-1 min-h-0">
        <ConversationView
          messages={displayMessages}
          sending={sending}
          thinkingLines={thinkingLines}
          researchSteps={researchSteps}
          streamingContent={streamingContent}
          error={error}
          onSendMessage={handleSend}
          onEditMessage={handleEditMessage}
          onRetryMessage={handleRetryMessage}
          messageFeedback={messageFeedback}
          onSetFeedback={handleSetFeedback}
          retryingMessageId={null}
          onCitationClick={onCitationClick}
        />
      </div>
    </div>
  );
}
