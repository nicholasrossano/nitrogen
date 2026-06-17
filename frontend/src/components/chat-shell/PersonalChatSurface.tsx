'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ChatMessage, FieldContext } from '@/lib/api';
import { ConversationView } from '@/components/core-chat/ConversationView';
import { LandingInput } from '@/components/core-chat/LandingInput';
import type { CoreChatMessage } from '@/types/chat';

interface PersonalChatSurfaceProps {
  initialChatId?: string | null;
  showLanding?: boolean;
  useLandingWhenEmpty?: boolean;
  onLandingStateChange?: (isOnLanding: boolean) => void;
  onChatListDirty?: () => void;
  onChatIdResolved?: (chatId: string) => void;
  projectContext?: string | null;
  composerLeadingActions?: React.ReactNode;
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

export function PersonalChatSurface({
  initialChatId = null,
  showLanding = false,
  useLandingWhenEmpty = true,
  onLandingStateChange,
  onChatListDirty,
  onChatIdResolved,
  projectContext = null,
  composerLeadingActions,
}: PersonalChatSurfaceProps) {
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [thinkingLines, setThinkingLines] = useState<string[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [messageFeedback, setFeedbackMap] = useState<
    Record<string, 'like' | 'dislike' | null>
  >({});
  const lastLoadedChatIdRef = useRef<string | null>(null);
  const titlePersistedRef = useRef(false);
  const [loadingChat, setLoadingChat] = useState(false);

  const loadChat = useCallback(async (chatId: string, fallbackTitle?: string | null) => {
    setLoadingChat(true);
    try {
      const { messages, title } = await api.getChatMessages(chatId);
      setLocalMessages(messages);
      setSessionTitle(title || fallbackTitle || 'Untitled');
      setCurrentChatId(chatId);
      setFeedbackMap(
        Object.fromEntries(
          messages.filter((m) => m.feedback).map((m) => [m.id, m.feedback!]),
        ) as Record<string, 'like' | 'dislike' | null>,
      );
      setThinkingLines([]);
      setStreamingContent('');
      setError(null);
      lastLoadedChatIdRef.current = chatId;
    } catch (err) {
      console.error('Failed to load chat messages:', err);
      setError('Failed to load chat history.');
    } finally {
      setLoadingChat(false);
    }
  }, []);

  useEffect(() => {
    if (!initialChatId) {
      if (lastLoadedChatIdRef.current !== null) {
        setLocalMessages([]);
        setCurrentChatId(null);
        lastLoadedChatIdRef.current = null;
      }
      setLoadingChat(false);
      return;
    }

    if (lastLoadedChatIdRef.current === initialChatId) {
      return;
    }

    if (currentChatId === initialChatId && localMessages.length > 0) {
      lastLoadedChatIdRef.current = initialChatId;
      setLoadingChat(false);
      return;
    }

    setLocalMessages([]);
    setThinkingLines([]);
    setStreamingContent('');
    void loadChat(initialChatId);
  }, [currentChatId, initialChatId, loadChat, localMessages.length]);

  useEffect(() => {
    if (sessionTitle && currentChatId && !titlePersistedRef.current) {
      titlePersistedRef.current = true;
      api.updateChatTitle(currentChatId, sessionTitle).catch(() => {});
    }
    if (!currentChatId) titlePersistedRef.current = false;
  }, [sessionTitle, currentChatId]);

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

          if (payload.chat_id) {
            setCurrentChatId(payload.chat_id);
            onChatListDirty?.();
            onChatIdResolved?.(payload.chat_id);
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
        currentChatId,
        null,
        projectContext,
        null,
        null,
        null,
        null,
        null,
      );
    },
    [currentChatId, onChatIdResolved, onChatListDirty, projectContext],
  );

  const handleSend = useCallback(
    async (content: string, _toolHint?: string) => {
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
        await sendViaStream(content, updatedMessages);
      } catch {
        setLocalMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
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

  const displayMessages = useMemo(
    () => localMessages.map(toCoreMessage),
    [localMessages],
  );

  const isOnLanding =
    !loadingChat &&
    !initialChatId &&
    localMessages.length === 0 &&
    (showLanding || useLandingWhenEmpty);

  useEffect(() => {
    onLandingStateChange?.(isOnLanding);
  }, [isOnLanding, onLandingStateChange]);

  if (isOnLanding) {
    return (
      <LandingInput
        onSend={handleSend}
        disabled={sending}
        hideTiles
        extraInputActions={composerLeadingActions}
      />
    );
  }

  return (
    <ConversationView
      messages={displayMessages}
      sending={sending}
      thinkingLines={thinkingLines}
      researchSteps={[]}
      streamingContent={streamingContent}
      error={error}
      onSendMessage={(content: string, toolHint?: string, _fieldContext?: FieldContext | null) => {
        void handleSend(content, toolHint);
      }}
      onEditMessage={handleEditMessage}
      onRetryMessage={handleRetryMessage}
      messageFeedback={messageFeedback}
      onSetFeedback={handleSetFeedback}
      retryingMessageId={null}
      historyLoading={loadingChat}
      extraInputActions={composerLeadingActions}
    />
  );
}
