'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useChatTabsStore } from '@/stores/chatTabsStore';
import { api } from '@/lib/api';
import type { ChatMessage } from '@/lib/api';
import { ConversationView } from './ConversationView';
import { LandingInput } from './LandingInput';
import { EDITOR_WIDGET_TYPES } from '@/components/editor/EditorSidePanel';
import type { EditorWidget } from '@/components/editor/EditorSidePanel';
import type { CoreChatMessage, ChatSession } from '@/stores/chatStore';

interface ProjectStandaloneChatViewProps {
  initiativeId: string;
  showLanding?: boolean;
  onMessageSent?: () => void;
  /** Called whenever the set of editor widgets in local messages changes */
  onEditorWidgetsChange?: (widgets: EditorWidget[]) => void;
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
  onMessageSent,
  onEditorWidgetsChange,
}: ProjectStandaloneChatViewProps) {
  const { ensureGroup, saveToHistory, deleteClosedTab } =
    useChatTabsStore();

  ensureGroup(initiativeId);

  const closedTabs = useChatTabsStore(
    (s) => s.groups[initiativeId]?.closedTabs ?? [],
  );

  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [messageFeedback, setFeedbackMap] = useState<
    Record<string, 'like' | 'dislike' | null>
  >({});

  // When showLanding transitions to true, save current conversation to history
  const prevShowLanding = useRef(showLanding);
  useEffect(() => {
    if (showLanding && !prevShowLanding.current && localMessages.length > 0) {
      const firstUser = localMessages.find((m) => m.role === 'user');
      const title =
        sessionTitle || firstUser?.content.slice(0, 80) || 'Chat';
      saveToHistory(initiativeId, title, localMessages);
      setLocalMessages([]);
      setSessionTitle(null);
      setFeedbackMap({});
    }
    prevShowLanding.current = showLanding;
  }, [showLanding, localMessages, sessionTitle, initiativeId, saveToHistory]);

  // Notify parent about editor widgets whenever local messages change
  useEffect(() => {
    if (!onEditorWidgetsChange) return;
    const widgets: EditorWidget[] = localMessages
      .filter(
        (m) =>
          m.widget_type &&
          m.widget_data &&
          (EDITOR_WIDGET_TYPES as readonly string[]).includes(m.widget_type),
      )
      .map((m) => ({ type: m.widget_type!, data: m.widget_data!, messageId: m.id }));
    onEditorWidgetsChange(widgets);
  }, [localMessages, onEditorWidgetsChange]);

  const displayMessages = useMemo(
    () => localMessages.map(toCoreMessage),
    [localMessages],
  );

  const sessions: ChatSession[] = useMemo(
    () =>
      closedTabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        createdAt: tab.createdAt,
        messages: tab.messages.map(toCoreMessage),
      })),
    [closedTabs],
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

      setLocalMessages((prev) => [...prev, userMsg]);
      setSending(true);

      try {
        const response = await api.sendMessage(
          initiativeId,
          content,
          toolHint,
        );
        setLocalMessages((prev) => [...prev, response.message]);
      } catch {
        setLocalMessages((prev) =>
          prev.filter((m) => m.id !== userMsg.id),
        );
      } finally {
        setSending(false);
      }
    },
    [initiativeId, localMessages.length, onMessageSent],
  );

  const handleEditMessage = useCallback(
    async (messageId: string, newContent: string) => {
      const idx = localMessages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      const truncated = localMessages.slice(0, idx);
      setLocalMessages(truncated);
      setSending(true);

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: newContent,
        widget_type: null,
        widget_data: null,
        created_at: new Date().toISOString(),
      };

      setLocalMessages((prev) => [...prev, userMsg]);

      try {
        const response = await api.sendMessage(initiativeId, newContent);
        setLocalMessages((prev) => [...prev, response.message]);
      } catch {
        setLocalMessages(truncated);
      } finally {
        setSending(false);
      }
    },
    [initiativeId, localMessages],
  );

  const handleRetryMessage = useCallback(
    async (messageId: string) => {
      const idx = localMessages.findIndex((m) => m.id === messageId);
      if (idx === -1 || localMessages[idx].role !== 'assistant') return;

      const preceding = localMessages.slice(0, idx);
      const lastUserMsg = [...preceding].reverse().find((m) => m.role === 'user');
      if (!lastUserMsg) return;

      setLocalMessages(preceding);
      setSending(true);

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: lastUserMsg.content,
        widget_type: null,
        widget_data: null,
        created_at: new Date().toISOString(),
      };

      setLocalMessages((prev) => [...prev, userMsg]);

      try {
        const response = await api.sendMessage(initiativeId, lastUserMsg.content);
        setLocalMessages((prev) => [...prev, response.message]);
      } catch {
        setLocalMessages(preceding);
      } finally {
        setSending(false);
      }
    },
    [initiativeId, localMessages],
  );

  const handleSetFeedback = useCallback(
    (messageId: string, feedback: 'like' | 'dislike' | null) => {
      setFeedbackMap((prev) => ({ ...prev, [messageId]: feedback }));
    },
    [],
  );

  const handleLoadSession = useCallback(
    (session: ChatSession) => {
      const tab = closedTabs.find((t) => t.id === session.id);
      if (!tab) return;

      // Save any current conversation first
      if (localMessages.length > 0) {
        const firstUser = localMessages.find((m) => m.role === 'user');
        const title =
          sessionTitle || firstUser?.content.slice(0, 80) || 'Chat';
        saveToHistory(initiativeId, title, localMessages);
      }

      setLocalMessages(tab.messages);
      setSessionTitle(tab.title);
      setFeedbackMap({});

      // Remove from history (it's now the active conversation)
      deleteClosedTab(initiativeId, session.id);
      onMessageSent?.();
    },
    [
      closedTabs,
      localMessages,
      sessionTitle,
      initiativeId,
      saveToHistory,
      deleteClosedTab,
      onMessageSent,
    ],
  );

  const handleDeleteSession = useCallback(
    (id: string) => {
      deleteClosedTab(initiativeId, id);
    },
    [initiativeId, deleteClosedTab],
  );

  const isOnLanding = showLanding || localMessages.length === 0;

  if (isOnLanding) {
    return (
      <LandingInput
        onSend={handleSend}
        sessions={sessions}
        onLoadSession={handleLoadSession}
        onDeleteSession={handleDeleteSession}
      />
    );
  }

  return (
    <ConversationView
      messages={displayMessages}
      sending={sending}
      thinkingLines={[]}
      streamingContent=""
      error={null}
      onSendMessage={handleSend}
      onEditMessage={handleEditMessage}
      onRetryMessage={handleRetryMessage}
      messageFeedback={messageFeedback}
      onSetFeedback={handleSetFeedback}
      retryingMessageId={null}
    />
  );
}
