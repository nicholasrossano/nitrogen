'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import type { ChatMessage, FieldContext, ResearchStep, SourceCitation } from '@/lib/api';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { filterSupportedFiles } from '@/lib/fileUtils';
import { AssociatedModulesTray, type AssociatedChatModule } from './AssociatedModulesTray';
import { ConversationView } from './ConversationView';
import { LandingInput } from './LandingInput';
import { InitiativeOverviewHeader } from './InitiativeOverviewHeader';
import { CompareProjectPicker, CompareChip } from './CompareProjectPicker';
import type { CompareProject } from './CompareProjectPicker';
import { EDITOR_WIDGET_TYPES } from '@/components/editor/EditorSidePanel';
import type { EditorWidget } from '@/components/editor/EditorSidePanel';
import type { CoreChatMessage, ChatSummary } from '@/stores/chatStore';
import { debugChatFlow } from '@/lib/chatDebug';

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

const MODEL_TYPE_TO_MODULE_ID: Record<string, string> = {
  lcoe: 'lcoe_model',
  carbon: 'carbon_model',
  solar: 'solar_estimate',
};

interface ProjectStandaloneChatViewProps {
  initiativeId: string;
  showLanding?: boolean;
  /** When true, hides the module tile grid on the landing page (Research mode) */
  hideTiles?: boolean;
  /** Custom content rendered above the landing composer */
  landingHeaderContent?: React.ReactNode;
  /** Landing layout override */
  landingLayoutMode?: 'default' | 'overview';
  /** Hide landing composer in overview mode */
  hideLandingComposer?: boolean;
  /** Allow the backend to return the initial upload-docs onboarding prompt */
  allowInitialProjectOnboarding?: boolean;
  /** When false, empty state stays in conversation mode instead of showing the landing UI */
  useLandingWhenEmpty?: boolean;
  /** Optional override for sends initiated from the landing composer */
  onLandingSend?: (content: string, toolHint?: string) => void;
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
  onOpenWorkspaceModule?: (module: {
    instanceId: string;
    moduleId: string;
    title?: string | null;
    chatId?: string | null;
    chatTitle?: string | null;
  }) => void;
  /** Ref that the parent can call to programmatically trigger a send (e.g. from ModuleLandingPage) */
  onSendRef?: React.MutableRefObject<((content: string, toolHint?: string) => void) | null>;
  /** Shared session history (project + user scoped) */
  sessions?: ChatSummary[];
  /** Active module context from the workspace panel */
  activeModuleContext?: { instanceId: string; moduleId: string; title?: string | null } | null;
  /** Automatically send a message into this chat view when it becomes active */
  pendingAutoSend?: { requestId: string; content: string; toolHint?: string } | null;
  onPendingAutoSendHandled?: () => void;
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

function resolveFieldContextModuleId(fieldContext?: FieldContext | null): string | null {
  if (!fieldContext) return null;
  if (fieldContext.module_id) return fieldContext.module_id;
  if (!fieldContext.model_type) return null;
  return MODEL_TYPE_TO_MODULE_ID[fieldContext.model_type] ?? null;
}

export function ProjectStandaloneChatView({
  initiativeId,
  showLanding = false,
  hideTiles = false,
  landingHeaderContent,
  landingLayoutMode,
  hideLandingComposer = false,
  allowInitialProjectOnboarding = false,
  useLandingWhenEmpty = true,
  onLandingSend,
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
  activeModuleContext = null,
  pendingAutoSend = null,
  onPendingAutoSendHandled,
  onDeleteChat,
  onChatListDirty,
}: ProjectStandaloneChatViewProps) {
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [chatModules, setChatModules] = useState<AssociatedChatModule[]>([]);
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
  const associatedModuleKeysRef = useRef<Set<string>>(new Set());
  const lastLoadedChatIdRef = useRef<string | null>(null);
  const lastAutoSendRequestIdRef = useRef<string | null>(null);

  const initiative = useInitiativeStore((s) => s.initiative);
  const projectMaterials = useInitiativeStore((s) => s.projectMaterials);
  const uploadMaterial = useInitiativeStore((s) => s.uploadMaterial);
  const generateInitiativeOverview = useInitiativeStore((s) => s.generateInitiativeOverview);
  const isOverviewLanding = hideTiles && !landingHeaderContent;

  useEffect(() => {
    if (initialTitle && !sessionTitle) {
      setSessionTitle(initialTitle);
    }
  }, [initialTitle, sessionTitle]);

  const loadChat = useCallback(
    async (chatId: string, fallbackTitle?: string | null) => {
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
        setResearchSteps([]);
        setError(null);
        lastLoadedChatIdRef.current = chatId;
        onMessageSent?.();
      } catch (err) {
        console.error('Failed to load chat messages:', err);
        setError('Failed to load chat history.');
      }
    },
    [onMessageSent],
  );

  useEffect(() => {
    if (!initialChatId) return;
    if (lastLoadedChatIdRef.current === initialChatId && currentChatId === initialChatId) {
      return;
    }
    void loadChat(initialChatId, initialTitle);
  }, [currentChatId, initialChatId, initialTitle, loadChat]);

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
      lastLoadedChatIdRef.current = null;
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
    async (
      content: string,
      currentMessages: ChatMessage[],
      toolHint?: string,
      fieldContext?: FieldContext | null,
      modelInputsContext?: string | null,
      associatedModule?: { instanceId: string; moduleId: string; title?: string | null } | null,
    ) => {
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

      debugChatFlow('transport-send', {
        surface: 'project-standalone-chat',
        route: '/api/v1/chat/stream',
        field_name: fieldContext?.field_name ?? null,
        model_type: fieldContext?.model_type ?? null,
        has_field_context: Boolean(fieldContext),
        has_model_inputs_context: Boolean(modelInputsContext),
        initiative_id: initiativeId,
        compare_mode: Boolean(compareIds),
      });

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

          const resolvedChatId = payload.chat_id || currentChatId;
          if (payload.chat_id) {
            setCurrentChatId(payload.chat_id);
            onChatListDirty?.();
          }

          if (resolvedChatId && associatedModule) {
            const associationKey = `${resolvedChatId}:${associatedModule.instanceId}`;
            if (!associatedModuleKeysRef.current.has(associationKey)) {
              associatedModuleKeysRef.current.add(associationKey);
              void api.associateChatModule(resolvedChatId, associatedModule.instanceId)
                .then(() => refreshChatModules(resolvedChatId))
                .catch((err: unknown) => {
                  associatedModuleKeysRef.current.delete(associationKey);
                  console.warn('Failed to associate interacted module with chat:', err);
                });
            }
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
        fieldContext ?? null,
        modelInputsContext ?? null,
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
        allowInitialProjectOnboarding,
      );
    },
    [
      initiativeId,
      currentChatId,
      compareProject,
      onChatListDirty,
      refreshChatModules,
      allowInitialProjectOnboarding,
    ],
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
    async (
      content: string,
      toolHint?: string,
      fieldContext?: FieldContext | null,
      modelInputsContext?: string | null,
    ) => {
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

      const matchedFieldContextModuleId = resolveFieldContextModuleId(fieldContext);
      const associatedModule =
        activeModuleContext &&
        (
          (matchedFieldContextModuleId && matchedFieldContextModuleId === activeModuleContext.moduleId) ||
          (toolHint && toolHint === activeModuleContext.moduleId)
        )
          ? activeModuleContext
          : null;

      try {
        await sendViaStream(content, updatedMessages, toolHint, fieldContext, modelInputsContext, associatedModule);
      } catch {
        setLocalMessages((prev) =>
          prev.filter((m) => m.id !== userMsg.id),
        );
        setSending(false);
      }
    },
    [activeModuleContext, localMessages, onMessageSent, sendViaStream],
  );

  useEffect(() => {
    if (!pendingAutoSend?.requestId) return;
    if (lastAutoSendRequestIdRef.current === pendingAutoSend.requestId) return;
    lastAutoSendRequestIdRef.current = pendingAutoSend.requestId;
    void handleSend(pendingAutoSend.content, pendingAutoSend.toolHint);
    onPendingAutoSendHandled?.();
  }, [handleSend, onPendingAutoSendHandled, pendingAutoSend]);

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
      await loadChat(session.id, session.title);
    },
    [loadChat],
  );

  // Expose handleSend to parent via ref so ModuleLandingPage can trigger a send
  useEffect(() => {
    if (onSendRef) onSendRef.current = handleSend;
    return () => {
      if (onSendRef) onSendRef.current = null;
    };
  }, [onSendRef, handleSend]);

  const isOnLanding = showLanding || (useLandingWhenEmpty && localMessages.length === 0);

  const associatedModules = useMemo(() => {
    return chatModules
      .filter((module, index, collection) =>
        collection.findIndex((candidate) => candidate.instance_id === module.instance_id) === index,
      );
  }, [chatModules]);

  const associatedModulesTray = useMemo(() => {
    if (associatedModules.length === 0) return null;

    return (
      <AssociatedModulesTray
        modules={associatedModules}
        onOpenWorkspaceModule={
          onOpenWorkspaceModule
            ? (module) => onOpenWorkspaceModule({
              ...module,
              chatId: currentChatId,
              chatTitle: sessionTitle,
            })
            : undefined
        }
      />
    );
  }, [associatedModules, currentChatId, onOpenWorkspaceModule, sessionTitle]);

  const inputChips = useMemo(
    () => (compareProject
      ? <CompareChip project={compareProject} onRemove={() => setCompareProject(null)} />
      : undefined),
    [compareProject],
  );

  useEffect(() => {
    onLandingStateChange?.(isOnLanding);
  }, [isOnLanding, onLandingStateChange]);

  useEffect(() => {
    if (!isOverviewLanding || !isOnLanding) return;

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
  }, [initiativeId, isOnLanding, isOverviewLanding]);

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
    if (!isOverviewLanding || !initiative || initiative.shared_role === 'viewer') return;
    if (projectMaterials.length === 0) return;
    if (initiative.overview_description?.trim()) return;
    if (overviewGenerating) return;

    const attemptKey = `${initiativeId}:${projectMaterials.length}`;
    if (autoOverviewAttemptRef.current === attemptKey) return;
    autoOverviewAttemptRef.current = attemptKey;
    void handleGenerateOverview();
  }, [
    handleGenerateOverview,
    initiative,
    initiativeId,
    isOverviewLanding,
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
          onSend={onLandingSend ?? handleSend}
          onUploadFile={handleUploadFile}
          sessions={sessions}
          onLoadSession={handleLoadSession}
          onDeleteSession={onDeleteChat}
          hideTiles={hideTiles}
          layoutMode={landingLayoutMode ?? (hideTiles ? 'overview' : 'default')}
          headerContent={landingHeaderContent ?? (hideTiles ? (
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
          ) : undefined)}
          extraInputActions={isOverviewLanding ? (
            <CompareProjectPicker
              currentProjectId={initiativeId}
              selected={compareProject}
              onSelect={setCompareProject}
            />
          ) : undefined}
          topComposerContent={associatedModulesTray}
          inputChips={inputChips}
          hideComposer={hideLandingComposer}
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
      extraInputActions={isOverviewLanding ? (
        <CompareProjectPicker
          currentProjectId={initiativeId}
          selected={compareProject}
          onSelect={setCompareProject}
        />
      ) : undefined}
      topComposerContent={associatedModulesTray}
      inputChips={inputChips}
    />
  );
}
