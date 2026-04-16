'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import type { ChatMessage, ResearchStep, SourceCitation } from '@/lib/api';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { filterSupportedFiles } from '@/lib/fileUtils';
import { ConversationView } from './ConversationView';
import { LandingInput } from './LandingInput';
import { InitiativeOverviewHeader } from './InitiativeOverviewHeader';
import { CompareProjectPicker, CompareChip } from './CompareProjectPicker';
import type { CompareProject } from './CompareProjectPicker';
import { ALL_MODULES, ModuleChip } from '@/components/chat/ModulePicker';
import { EDITOR_WIDGET_TYPES } from '@/components/editor/EditorSidePanel';
import type { EditorWidget } from '@/components/editor/EditorSidePanel';
import type { CoreChatMessage, ChatSummary } from '@/stores/chatStore';

const DELIVERABLE_WIDGET_TYPES = ['memo_viewer', 'checklist_viewer'];
const CHAT_MODULE_WIDGET_TYPES = new Set([
  'module_workspace',
  'lcoe_inputs',
  'lcoe_output',
  'carbon_inputs',
  'carbon_output',
  'solar_inputs',
  'solar_output',
]);
const activeModulesCountCache = new Map<string, number>();

interface ProjectStandaloneChatViewProps {
  initiativeId: string;
  showLanding?: boolean;
  /** When true, hides the module tile grid on the landing page (Research mode) */
  hideTiles?: boolean;
  /** When false, empty state stays in conversation mode instead of showing the landing UI */
  useLandingWhenEmpty?: boolean;
  initialChatId?: string | null;
  initialTitle?: string | null;
  onMessageSent?: () => void;
  /** Called whenever the set of editor widgets in local messages changes */
  onEditorWidgetsChange?: (widgets: EditorWidget[]) => void;
  /** Called when user clicks an internal citation */
  onCitationClick?: (citation: SourceCitation) => void;
  /** Called when the active chat metadata changes */
  onChatMetaChange?: (meta: { chatId: string | null; title: string | null }) => void;
  /** Called when this view enters or leaves its landing state */
  onLandingStateChange?: (isOnLanding: boolean) => void;
  /** Open a module workspace from a chat-associated module chip */
  onOpenWorkspaceModule?: (module: { instanceId: string; moduleId: string; title?: string | null }) => void;
  /** Ref that the parent can call to programmatically trigger a send (e.g. from ModuleLandingPage) */
  onSendRef?: React.MutableRefObject<((content: string, toolHint?: string) => void) | null>;
  /** Shared session history (project + user scoped) */
  sessions?: ChatSummary[];
  /** Delete a chat from shared history */
  onDeleteChat?: (chatId: string) => void;
  /** Ask parent to refresh shared chat history */
  onChatListDirty?: () => void;
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
  initialChatId = null,
  initialTitle = null,
  onMessageSent,
  onEditorWidgetsChange,
  onCitationClick,
  onChatMetaChange,
  onLandingStateChange,
  onOpenWorkspaceModule,
  onSendRef,
  sessions = [],
  onDeleteChat,
  onChatListDirty,
}: ProjectStandaloneChatViewProps) {
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [chatModules, setChatModules] = useState<{ instance_id: string; module_id: string; title: string | null; status: string; started_at: string | null }[]>([]);
  const [thinkingLines, setThinkingLines] = useState<string[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [researchSteps, setResearchSteps] = useState<ResearchStep[]>([]);
  const [messageFeedback, setFeedbackMap] = useState<
    Record<string, 'like' | 'dislike' | null>
  >({});
  const [compareProject, setCompareProject] = useState<CompareProject | null>(null);
  const [activeModulesCount, setActiveModulesCount] = useState<number | null>(
    () => activeModulesCountCache.get(initiativeId) ?? null,
  );
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewGenerating, setOverviewGenerating] = useState(false);
  const lastReportedMetaRef = useRef<{ chatId: string | null; title: string | null } | null>(null);
  const autoOverviewAttemptRef = useRef<string | null>(null);

  const initiative = useInitiativeStore((s) => s.initiative);
  const projectMaterials = useInitiativeStore((s) => s.projectMaterials);
  const uploadMaterial = useInitiativeStore((s) => s.uploadMaterial);
  const generateInitiativeOverview = useInitiativeStore((s) => s.generateInitiativeOverview);

  useEffect(() => {
    if (initialTitle && !sessionTitle) {
      setSessionTitle(initialTitle);
    }
  }, [initialTitle, sessionTitle]);

  useEffect(() => {
    if (!initialChatId) return;
    if (currentChatId === initialChatId || localMessages.length > 0) return;

    let cancelled = false;
    api.getChatMessages(initialChatId)
      .then(({ messages, title }) => {
        if (cancelled) return;
        setLocalMessages(messages);
        setSessionTitle(title || initialTitle || 'Untitled');
        setCurrentChatId(initialChatId);
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
  }, [initialChatId, initialTitle, currentChatId, localMessages.length]);

  useEffect(() => {
    const nextMeta = {
      chatId: currentChatId,
      title: sessionTitle,
    };
    const prevMeta = lastReportedMetaRef.current;
    if (
      prevMeta?.chatId === nextMeta.chatId &&
      prevMeta?.title === nextMeta.title
    ) {
      return;
    }
    lastReportedMetaRef.current = nextMeta;
    onChatMetaChange?.(nextMeta);
  }, [currentChatId, sessionTitle, onChatMetaChange]);

  // When showLanding transitions to true, clear current conversation
  // (it's already persisted to DB by the streaming endpoint)
  const prevShowLanding = useRef(showLanding);
  useEffect(() => {
    if (showLanding && !prevShowLanding.current && localMessages.length > 0) {
      // Refresh shared chats so the finished conversation appears in history.
      onChatListDirty?.();
      setLocalMessages([]);
      setSessionTitle(null);
      setCurrentChatId(null);
      setChatModules([]);
      setFeedbackMap({});
      setCompareProject(null);
    }
    prevShowLanding.current = showLanding;
  }, [showLanding, localMessages, onChatListDirty]);

  // Persist the AI-generated title to the DB chat once both are available
  const titlePersistedRef = useRef(false);
  useEffect(() => {
    if (sessionTitle && currentChatId && !titlePersistedRef.current) {
      titlePersistedRef.current = true;
      api.updateChatTitle(currentChatId, sessionTitle).catch(() => {});
    }
    if (!currentChatId) titlePersistedRef.current = false;
  }, [sessionTitle, currentChatId]);

  const refreshChatModules = useCallback(async (chatId: string) => {
    try {
      const { modules } = await api.getChatModules(chatId);
      setChatModules(modules);
    } catch (err) {
      console.warn('Failed to load chat modules:', err);
    }
  }, []);

  useEffect(() => {
    if (!currentChatId) {
      setChatModules([]);
      return;
    }
    void refreshChatModules(currentChatId);
  }, [currentChatId, refreshChatModules]);

  useEffect(() => {
    if (!currentChatId) return;
    const latestAssistant = [...localMessages].reverse().find((message) => message.role === 'assistant');
    if (!latestAssistant?.widget_type || !CHAT_MODULE_WIDGET_TYPES.has(latestAssistant.widget_type)) {
      return;
    }
    void refreshChatModules(currentChatId);
  }, [currentChatId, localMessages, refreshChatModules]);

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

          if (payload.chat_id) {
            setCurrentChatId(payload.chat_id);
            onChatListDirty?.();
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
    [initiativeId, currentChatId, compareProject, onChatListDirty],
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
    async (session: ChatSummary) => {
      try {
        const { messages, title } = await api.getChatMessages(session.id);
        setLocalMessages(messages);
        setSessionTitle(title || session.title);
        setCurrentChatId(session.id);
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

  // Expose handleSend to parent via ref so ModuleLandingPage can trigger a send
  useEffect(() => {
    if (onSendRef) onSendRef.current = handleSend;
    return () => {
      if (onSendRef) onSendRef.current = null;
    };
  }, [onSendRef, handleSend]);

  const isOnLanding = showLanding || (useLandingWhenEmpty && localMessages.length === 0);

  const moduleChips = useMemo(() => {
    if (chatModules.length === 0) return null;

    return (
      <div className="flex flex-wrap gap-1.5">
        {chatModules.map((module) => {
          const moduleOption = ALL_MODULES.find((candidate) => candidate.id === module.module_id);
          if (!moduleOption) return null;

          return (
            <ModuleChip
              key={module.instance_id}
              module={moduleOption}
              onClick={
                onOpenWorkspaceModule
                  ? () =>
                      onOpenWorkspaceModule({
                        instanceId: module.instance_id,
                        moduleId: module.module_id,
                        title: module.title ?? moduleOption.name,
                      })
                  : undefined
              }
            />
          );
        })}
      </div>
    );
  }, [chatModules, onOpenWorkspaceModule]);

  const inputChips = useMemo(() => {
    if (!compareProject && !moduleChips) return undefined;
    return (
      <>
        {compareProject ? (
          <CompareChip project={compareProject} onRemove={() => setCompareProject(null)} />
        ) : null}
        {moduleChips}
      </>
    );
  }, [compareProject, moduleChips]);

  useEffect(() => {
    onLandingStateChange?.(isOnLanding);
  }, [isOnLanding, onLandingStateChange]);

  useEffect(() => {
    if (!hideTiles || !isOnLanding) return;

    const cachedCount = activeModulesCountCache.get(initiativeId);
    if (cachedCount !== undefined) {
      setActiveModulesCount(cachedCount);
    } else {
      setActiveModulesCount(null);
    }

    const hadCachedCount = cachedCount !== undefined;

    let cancelled = false;
    api.listModuleInstances(initiativeId)
      .then((instances) => {
        if (!cancelled) {
          activeModulesCountCache.set(initiativeId, instances.length);
          setActiveModulesCount(instances.length);
        }
      })
      .catch(() => {
        if (!cancelled) {
          if (!hadCachedCount) {
            setActiveModulesCount(null);
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hideTiles, initiativeId, isOnLanding]);

  const handleGenerateOverview = useCallback(async () => {
    if (!initiative) return;
    setOverviewError(null);
    setOverviewGenerating(true);
    try {
      await generateInitiativeOverview(initiativeId);
    } catch (err) {
      setOverviewError(err instanceof Error ? err.message : 'Failed to refresh overview.');
    } finally {
      setOverviewGenerating(false);
    }
  }, [generateInitiativeOverview, initiative, initiativeId]);

  useEffect(() => {
    setOverviewError(null);
    setOverviewGenerating(false);
    setActiveModulesCount(activeModulesCountCache.get(initiativeId) ?? null);
    autoOverviewAttemptRef.current = null;
  }, [initiativeId]);

  useEffect(() => {
    if (!hideTiles || !initiative || initiative.shared_role === 'viewer') return;
    if (projectMaterials.length === 0) return;
    if (initiative.overview_description?.trim()) return;
    if (overviewGenerating) return;

    const attemptKey = `${initiativeId}:${projectMaterials.length}`;
    if (autoOverviewAttemptRef.current === attemptKey) return;
    autoOverviewAttemptRef.current = attemptKey;
    void handleGenerateOverview();
  }, [
    handleGenerateOverview,
    hideTiles,
    initiative,
    initiativeId,
    overviewGenerating,
    projectMaterials.length,
  ]);

  if (isOnLanding) {
    const filesUploaded = projectMaterials.length;
    const modulesCreated = activeModulesCount;
    const canRefreshOverview = Boolean(
      initiative &&
      initiative.shared_role !== 'viewer' &&
      filesUploaded > 0
    );

    return (
      <>
        <LandingInput
          onSend={handleSend}
          onUploadFile={handleUploadFile}
          sessions={sessions}
          onLoadSession={handleLoadSession}
          onDeleteSession={onDeleteChat}
          hideTiles={hideTiles}
          layoutMode={hideTiles ? 'overview' : 'default'}
          headerContent={hideTiles ? (
            initiative ? (
              <InitiativeOverviewHeader
                initiative={initiative}
                filesUploaded={filesUploaded}
                modulesCreated={modulesCreated}
                isGenerating={overviewGenerating}
                errorMessage={overviewError}
                canRefresh={canRefreshOverview}
                onRefresh={handleGenerateOverview}
              />
            ) : null
          ) : undefined}
          extraInputActions={hideTiles ? (
            <CompareProjectPicker
              currentProjectId={initiativeId}
              selected={compareProject}
              onSelect={setCompareProject}
            />
          ) : undefined}
          inputChips={inputChips}
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
      initiativeId={initiativeId}
      onCitationClick={onCitationClick}
      extraInputActions={hideTiles ? (
        <CompareProjectPicker
          currentProjectId={initiativeId}
          selected={compareProject}
          onSelect={setCompareProject}
        />
      ) : undefined}
      inputChips={inputChips}
    />
  );
}
