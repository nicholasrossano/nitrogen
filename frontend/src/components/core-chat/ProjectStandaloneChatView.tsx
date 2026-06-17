'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Loader2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import type { ChatMessage, FieldContext, ResearchStep } from '@/lib/api';
import type { ResearchPanelCitation } from './ResearchPanel';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { filterSupportedFiles } from '@/lib/fileUtils';
import { AssociatedAssessmentsTray, type AssociatedChatAssessment } from './AssociatedAssessmentsTray';
import { ConversationView } from './ConversationView';
import { LandingInput } from './LandingInput';
import { InitiativeOverviewHeader } from './InitiativeOverviewHeader';
import { ProjectOutputsSection } from '@/components/chat-shell/ProjectOutputsSection';
import { CompareProjectPicker, CompareChip } from './CompareProjectPicker';
import type { CompareProject } from './CompareProjectPicker';
import { AssessmentPicker } from '@/components/chat/AssessmentPicker';
import { EDITOR_WIDGET_TYPES } from '@/components/editor/EditorSidePanel';
import type { EditorWidget } from '@/components/editor/EditorSidePanel';
import type { CoreChatMessage, ChatSummary } from '@/types/chat';
import type { ProposedValueApplyRequest } from '@/components/widgets/ProposedValueWidget';
import { debugChatFlow } from '@/lib/chatDebug';
import type { AssessmentProgressData } from '@/components/ui/ReadinessProgressBar';

const DELIVERABLE_WIDGET_TYPES = ['memo_viewer', 'checklist_viewer'];
const CHAT_MODULE_WIDGET_TYPES = new Set([
  'assessment_workspace',
  'lcoe_inputs',
  'lcoe_output',
  'carbon_inputs',
  'carbon_output',
  'solar_inputs',
  'solar_output',
]);
const activeAssessmentsCountCache = new Map<string, number>();

const MODEL_TYPE_TO_MODULE_ID: Record<string, string> = {
  lcoe: 'lcoe_model',
  carbon: 'carbon_model',
  solar: 'solar_estimate',
};

interface ProjectChatSurfaceProps {
  initiativeId: string;
  showLanding?: boolean;
  /** When true, hides the assessment tile grid on the landing page (Research mode) */
  hideTiles?: boolean;
  /** Show module picker in composer (chat workbench — tiles hidden but modules still reachable) */
  showComposerModulePicker?: boolean;
  /** Custom content rendered above the landing composer */
  landingHeaderContent?: React.ReactNode;
  /** Large serif project title above the landing composer */
  landingComposerTitle?: string | null;
  /** Landing layout override */
  landingLayoutMode?: 'default' | 'overview';
  /** Hide landing composer in overview mode */
  hideLandingComposer?: boolean;
  /** Allow the backend to return the initial upload-docs onboarding prompt */
  allowInitialProjectOnboarding?: boolean;
  /** When false, empty state stays in conversation mode instead of showing the landing UI */
  useLandingWhenEmpty?: boolean;
  /** Restore latest existing chat for this initiative on initial mount */
  restoreLatestChatOnMount?: boolean;
  /** Optional override for sends initiated from the landing composer */
  onLandingSend?: (content: string, toolHint?: string) => void;
  initialChatId?: string | null;
  initialTitle?: string | null;
  onMessageSent?: () => void;
  /** Called whenever the set of editor widgets in local messages changes */
  onEditorWidgetsChange?: (widgets: EditorWidget[]) => void;
  /** Called when user opens an internal citation document */
  onOpenDocument?: (citation: ResearchPanelCitation) => void;
  /** Called when the active chat metadata changes */
  onChatMetaChange?: (meta: { chatId: string | null; title: string | null }) => void;
  /** Called when this view enters or leaves its landing state */
  onLandingStateChange?: (isOnLanding: boolean) => void;
  /** Open a assessment workspace from a chat-associated assessment chip */
  onOpenWorkspaceAssessment?: (assessment: {
    instanceId: string;
    assessmentId: string;
    title?: string | null;
    chatId?: string | null;
    chatTitle?: string | null;
  }) => void;
  /** Ref that the parent can call to programmatically trigger a send */
  onSendRef?: React.MutableRefObject<((content: string, toolHint?: string) => void) | null>;
  /** Shared session history (project + user scoped) */
  sessions?: ChatSummary[];
  /** Active assessment context from the workspace panel */
  activeAssessmentContext?: { instanceId: string; assessmentId: string; title?: string | null } | null;
  /** Assumption pinned to this chat tab (if any). */
  focusedAssumptionId?: string | null;
  /** Automatically send a message into this chat view when it becomes active */
  pendingAutoSend?: {
    requestId: string;
    content: string;
    toolHint?: string;
    fieldContext?: FieldContext | null;
    modelInputsContext?: string | null;
    assumptionId?: string | null;
  } | null;
  onPendingAutoSendHandled?: () => void;
  /** Delete a chat from shared history */
  onDeleteChat?: (chatId: string) => void;
  /** Ask parent to refresh shared chat history */
  onChatListDirty?: () => void;
  /** Fixed content rendered above the messages area (e.g. a deep-dive context widget) */
  topContent?: React.ReactNode;
  /** Layout mode for top content when present */
  topContentMode?: 'inline' | 'panel';
  /** Ambient project context automatically included with every send in this chat view */
  projectContext?: string | null;
  /** Called before sending a message from the composer */
  onBeforeSendMessage?: () => void;
  /** Optional assessments progress header shown in overview mode */
  assessmentProgress?: AssessmentProgressData | null;
  /** Open the project assumptions workspace tab from overview. */
  onOpenAssumptions?: () => void;
  /** Enable promote-to-finding on assistant messages */
  showPromoteFinding?: boolean;
  onPromoteMessage?: (messageId: string, body: string) => void;
  /** Controls rendered on the left side of the composer toolbar (before attach/send) */
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

function resolveFieldContextAssessmentId(fieldContext?: FieldContext | null): string | null {
  if (!fieldContext) return null;
  if (fieldContext.assessment_id) return fieldContext.assessment_id;
  if (!fieldContext.model_type) return null;
  return MODEL_TYPE_TO_MODULE_ID[fieldContext.model_type] ?? null;
}

function normalizeProposalKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function ProjectChatSurface({
  initiativeId,
  showLanding = false,
  hideTiles = false,
  showComposerModulePicker = false,
  landingHeaderContent,
  landingComposerTitle,
  landingLayoutMode,
  hideLandingComposer = false,
  allowInitialProjectOnboarding = false,
  useLandingWhenEmpty = true,
  restoreLatestChatOnMount = false,
  onLandingSend,
  initialChatId = null,
  initialTitle = null,
  onMessageSent,
  onEditorWidgetsChange,
  onOpenDocument,
  onChatMetaChange,
  onLandingStateChange,
  onOpenWorkspaceAssessment,
  onSendRef,
  sessions = [],
  activeAssessmentContext = null,
  focusedAssumptionId = null,
  pendingAutoSend = null,
  onPendingAutoSendHandled,
  onDeleteChat,
  onChatListDirty,
  topContent,
  topContentMode = 'inline',
  projectContext = null,
  onBeforeSendMessage,
  assessmentProgress = null,
  onOpenAssumptions,
  showPromoteFinding = false,
  onPromoteMessage,
  composerLeadingActions,
}: ProjectChatSurfaceProps) {
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [chatAssessments, setChatAssessments] = useState<AssociatedChatAssessment[]>([]);
  const [thinkingLines, setThinkingLines] = useState<string[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [researchSteps, setResearchSteps] = useState<ResearchStep[]>([]);
  const [messageFeedback, setFeedbackMap] = useState<
    Record<string, 'like' | 'dislike' | null>
  >({});
  const [compareProject, setCompareProject] = useState<CompareProject | null>(null);
  const [activeAssessmentsCount, setActiveAssessmentsCount] = useState<number | null>(
    () => activeAssessmentsCountCache.get(initiativeId) ?? null,
  );
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewGenerating, setOverviewGenerating] = useState(false);
  const [healthRefreshToken, setHealthRefreshToken] = useState(0);
  const [loadingChat, setLoadingChat] = useState(false);
  const lastReportedMetaRef = useRef<{ chatId: string | null; title: string | null } | null>(null);
  const autoOverviewAttemptRef = useRef<string | null>(null);
  const associatedAssessmentKeysRef = useRef<Set<string>>(new Set());
  const lastLoadedChatIdRef = useRef<string | null>(null);
  const lastAutoSendRequestIdRef = useRef<string | null>(null);
  const hasAttemptedAutoRestoreRef = useRef(false);

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
        setResearchSteps([]);
        setError(null);
        lastLoadedChatIdRef.current = chatId;
        onMessageSent?.();
      } catch (err) {
        console.error('Failed to load chat messages:', err);
        setError('Failed to load chat history.');
      } finally {
        setLoadingChat(false);
      }
    },
    [onMessageSent],
  );

  useEffect(() => {
    if (!initialChatId) {
      if (lastLoadedChatIdRef.current !== null) {
        setLocalMessages([]);
        setCurrentChatId(null);
        setChatAssessments([]);
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
    setResearchSteps([]);
    void loadChat(initialChatId, initialTitle);
  }, [currentChatId, initialChatId, initialTitle, loadChat, localMessages.length]);

  useEffect(() => {
    if (!restoreLatestChatOnMount) return;
    if (initialChatId) return;
    if (showLanding) return;
    if (currentChatId) return;
    if (localMessages.length > 0) return;
    if (hasAttemptedAutoRestoreRef.current) return;

    hasAttemptedAutoRestoreRef.current = true;

    void api.getChats(initiativeId)
      .then(async ({ chats }) => {
        const latest = chats?.[0];
        if (!latest?.id) return;
        await loadChat(latest.id, latest.title);
      })
      .catch(() => {
        // Keep default landing behavior if auto-restore fails.
      });
  }, [
    currentChatId,
    initialChatId,
    initiativeId,
    loadChat,
    localMessages.length,
    restoreLatestChatOnMount,
    showLanding,
  ]);

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
      setChatAssessments([]);
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

  const refreshChatAssessments = useCallback(async (chatId: string) => {
    try {
      const { assessments } = await api.getChatAssessments(chatId);
      setChatAssessments(assessments);
    } catch (err) {
      console.warn('Failed to load chat assessments:', err);
    }
  }, []);

  useEffect(() => {
    if (!currentChatId) {
      setChatAssessments([]);
      return;
    }
    void refreshChatAssessments(currentChatId);
  }, [currentChatId, refreshChatAssessments]);

  useEffect(() => {
    if (!currentChatId) return;
    const latestAssistant = [...localMessages].reverse().find((message) => message.role === 'assistant');
    if (!latestAssistant?.widget_type || !CHAT_MODULE_WIDGET_TYPES.has(latestAssistant.widget_type)) {
      return;
    }
    void refreshChatAssessments(currentChatId);
  }, [currentChatId, localMessages, refreshChatAssessments]);

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

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { messageId?: string; widgetData?: Record<string, any> }
        | undefined;
      if (!detail?.messageId || !detail.widgetData) return;
      setLocalMessages((prev) => prev.map((message) => (
        message.id === detail.messageId
          ? { ...message, widget_data: detail.widgetData ?? null }
          : message
      )));
    };

    window.addEventListener('nitrogen:chat-widget-updated', handler);
    return () => window.removeEventListener('nitrogen:chat-widget-updated', handler);
  }, []);

  const handleApplyProposedValue = useCallback(
    async ({ fieldName, value, modelType }: ProposedValueApplyRequest): Promise<boolean> => {
      const assessmentId = MODEL_TYPE_TO_MODULE_ID[modelType];
      if (!assessmentId) {
        setError(`I couldn't find a assessment type for ${modelType}.`);
        return false;
      }

      const candidates = [
        ...(activeAssessmentContext?.assessmentId === assessmentId
          ? [{
              instance_id: activeAssessmentContext.instanceId,
              assessment_id: activeAssessmentContext.assessmentId,
              title: activeAssessmentContext.title ?? null,
              status: 'started',
              started_at: null,
            }]
          : []),
        ...chatAssessments.filter((assessment) => assessment.assessment_id === assessmentId),
      ].filter(
        (assessment, index, collection) =>
          collection.findIndex((candidate) => candidate.instance_id === assessment.instance_id) === index,
      );

      const target = candidates[0];
      if (!target) {
        setError('Open or associate the matching assessment before accepting this proposed value.');
        return false;
      }

      try {
        const workflow = await api.getStagedAssessmentWorkflowState(target.instance_id);
        const inputsStage = workflow.workflow_state.stages.inputs;
        const items = inputsStage?.data?.items ?? [];
        const normalizedFieldName = normalizeProposalKey(fieldName);
        const row = items.find((item) => {
          const content = item.content ?? {};
          const explicitFieldName = typeof content.field_name === 'string' ? content.field_name : '';
          const variable = typeof content.variable === 'string' ? content.variable : '';
          return explicitFieldName === fieldName
            || normalizeProposalKey(explicitFieldName) === normalizedFieldName
            || normalizeProposalKey(variable) === normalizedFieldName;
        });

        if (!row) {
          setError(`I couldn't find ${fieldName.replace(/_/g, ' ')} in the ${target.title || assessmentId} inputs.`);
          return false;
        }

        await api.editStageItem(
          target.instance_id,
          'inputs',
          row.id,
          {
            ...row.content,
            value,
            status: 'validated',
            source: 'user',
          },
          workflow.workflow_version,
        );

        window.dispatchEvent(new CustomEvent('nitrogen:assessment-workflow-updated', {
          detail: {
            instanceId: target.instance_id,
            assessmentId,
            stageId: 'inputs',
            itemId: row.id,
          },
        }));
        setError(null);
        return true;
      } catch (err) {
        console.error('Failed to apply proposed value:', err);
        setError(err instanceof Error ? err.message : 'Failed to apply the proposed value.');
        return false;
      }
    },
    [activeAssessmentContext, chatAssessments],
  );

  const displayMessages = useMemo(
    () => localMessages.map(toCoreMessage),
    [localMessages],
  );

  const sendViaStream = useCallback(
    async (
      content: string,
      currentMessages: ChatMessage[],
      toolHint?: string,
      projectContextOverride?: string | null,
      fieldContext?: FieldContext | null,
      modelInputsContext?: string | null,
      associatedAssessment?: { instanceId: string; assessmentId: string; title?: string | null } | null,
      assumptionId?: string | null,
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
        has_project_context: Boolean(projectContextOverride),
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

          if (resolvedChatId && associatedAssessment) {
            const associationKey = `${resolvedChatId}:${associatedAssessment.instanceId}`;
            if (!associatedAssessmentKeysRef.current.has(associationKey)) {
              associatedAssessmentKeysRef.current.add(associationKey);
              void api.associateChatAssessment(resolvedChatId, associatedAssessment.instanceId)
                .then(() => refreshChatAssessments(resolvedChatId))
                .catch((err: unknown) => {
                  associatedAssessmentKeysRef.current.delete(associationKey);
                  console.warn('Failed to associate interacted assessment with chat:', err);
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
        projectContextOverride ?? null,
        fieldContext ?? null,
        modelInputsContext ?? null,
        associatedAssessment
          ? {
            instance_id: associatedAssessment.instanceId,
            assessment_id: associatedAssessment.assessmentId,
            title: associatedAssessment.title ?? null,
          }
          : null,
        initiativeId,
        assumptionId ?? null,
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
      refreshChatAssessments,
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
      assumptionIdOverride?: string | null,
    ) => {
      onBeforeSendMessage?.();
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

      const matchedFieldContextAssessmentId = resolveFieldContextAssessmentId(fieldContext);
      const effectiveAssumptionId =
        assumptionIdOverride
        ?? fieldContext?.assumption_id
        ?? focusedAssumptionId
        ?? null;
      const associatedAssessment =
        activeAssessmentContext &&
        (
          (matchedFieldContextAssessmentId && matchedFieldContextAssessmentId === activeAssessmentContext.assessmentId) ||
          (toolHint && toolHint === activeAssessmentContext.assessmentId)
        )
          ? activeAssessmentContext
          : null;

      try {
        await sendViaStream(
          content,
          updatedMessages,
          toolHint,
          projectContext,
          fieldContext,
          modelInputsContext,
          associatedAssessment,
          effectiveAssumptionId,
        );
      } catch {
        setLocalMessages((prev) =>
          prev.filter((m) => m.id !== userMsg.id),
        );
        setSending(false);
      }
    },
    [
      activeAssessmentContext,
      focusedAssumptionId,
      localMessages,
      onBeforeSendMessage,
      onMessageSent,
      projectContext,
      sendViaStream,
    ],
  );

  useEffect(() => {
    if (!pendingAutoSend?.requestId) return;
    if (lastAutoSendRequestIdRef.current === pendingAutoSend.requestId) return;
    lastAutoSendRequestIdRef.current = pendingAutoSend.requestId;
    void handleSend(
      pendingAutoSend.content,
      pendingAutoSend.toolHint,
      pendingAutoSend.fieldContext ?? null,
      pendingAutoSend.modelInputsContext ?? null,
      pendingAutoSend.assumptionId ?? null,
    );
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
        await sendViaStream(
          newContent,
          updatedMessages,
          undefined,
          projectContext,
          undefined,
          undefined,
          null,
          focusedAssumptionId,
        );
      } catch {
        setLocalMessages(truncated);
        setSending(false);
      }
    },
    [focusedAssumptionId, localMessages, projectContext, sendViaStream],
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
        await sendViaStream(
          lastUserMsg.content,
          updatedMessages,
          undefined,
          projectContext,
          undefined,
          undefined,
          null,
          focusedAssumptionId,
        );
      } catch {
        setLocalMessages(preceding);
        setSending(false);
      }
    },
    [focusedAssumptionId, localMessages, projectContext, sendViaStream],
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

  // Expose handleSend to parent via ref for programmatic sends.
  useEffect(() => {
    if (onSendRef) onSendRef.current = handleSend;
    return () => {
      if (onSendRef) onSendRef.current = null;
    };
  }, [onSendRef, handleSend]);

  const isOnLanding =
    !loadingChat &&
    !initialChatId &&
    localMessages.length === 0 &&
    (showLanding || useLandingWhenEmpty);

  const associatedAssessments = useMemo(() => {
    return chatAssessments
      .filter((assessment, index, collection) =>
        collection.findIndex((candidate) => candidate.instance_id === assessment.instance_id) === index,
      );
  }, [chatAssessments]);

  const associatedAssessmentsTray = useMemo(() => {
    if (associatedAssessments.length === 0) return null;

    return (
      <AssociatedAssessmentsTray
        assessments={associatedAssessments}
        onOpenWorkspaceAssessment={
          onOpenWorkspaceAssessment
            ? (assessment) => onOpenWorkspaceAssessment({
              ...assessment,
              chatId: currentChatId,
              chatTitle: sessionTitle,
            })
            : undefined
        }
      />
    );
  }, [associatedAssessments, currentChatId, onOpenWorkspaceAssessment, sessionTitle]);

  const inputChips = useMemo(
    () => (compareProject
      ? <CompareChip project={compareProject} onRemove={() => setCompareProject(null)} />
      : undefined),
    [compareProject],
  );

  const composerModulePicker = showComposerModulePicker ? (
    <AssessmentPicker
      selected={null}
      onSelect={(assessment) => {
        if (assessment) void handleSend(`Generate ${assessment.name}`, assessment.id);
      }}
      disabled={sending}
      mode="project"
    />
  ) : null;

  const landingExtraInputActions = isOverviewLanding ? (
    <>
      <CompareProjectPicker
        currentProjectId={initiativeId}
        selected={compareProject}
        onSelect={setCompareProject}
      />
      {composerModulePicker}
    </>
  ) : composerModulePicker;

  const conversationExtraInputActions = landingExtraInputActions;

  const composerToolbarLeading = (composerLeadingActions || conversationExtraInputActions) ? (
    <div className="flex items-center gap-1.5 min-w-0">
      {composerLeadingActions}
      {conversationExtraInputActions}
    </div>
  ) : null;

  useEffect(() => {
    onLandingStateChange?.(isOnLanding);
  }, [isOnLanding, onLandingStateChange]);

  useEffect(() => {
    if (!isOverviewLanding || !isOnLanding) return;

    const cachedCount = activeAssessmentsCountCache.get(initiativeId);
    if (cachedCount !== undefined) {
      setActiveAssessmentsCount(cachedCount);
    } else {
      setActiveAssessmentsCount(null);
    }

    const hadCachedCount = cachedCount !== undefined;

    let cancelled = false;
    api.listAssessmentInstances(initiativeId)
      .then((instances) => {
        if (!cancelled) {
          activeAssessmentsCountCache.set(initiativeId, instances.length);
          setActiveAssessmentsCount(instances.length);
        }
      })
      .catch(() => {
        if (!cancelled) {
          if (!hadCachedCount) {
            setActiveAssessmentsCount(null);
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

  const handleRefreshOverviewPanel = useCallback(() => {
    if (!initiative || initiative.shared_role === 'viewer') return;
    if (projectMaterials.length > 0) void handleGenerateOverview();
    setHealthRefreshToken((prev) => prev + 1);
  }, [handleGenerateOverview, initiative, projectMaterials.length]);

  useEffect(() => {
    setOverviewError(null);
    setOverviewGenerating(false);
    setActiveAssessmentsCount(activeAssessmentsCountCache.get(initiativeId) ?? null);
    setHealthRefreshToken(0);
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
    const assessmentsCreated = activeAssessmentsCount;

    return (
      <>
        <LandingInput
          onSend={onLandingSend ?? handleSend}
          onUploadFile={handleUploadFile}
          sessions={sessions}
          onLoadSession={handleLoadSession}
          onDeleteSession={onDeleteChat}
          hideTiles={hideTiles}
          composerTitle={landingComposerTitle}
          layoutMode={landingLayoutMode ?? (hideTiles ? 'overview' : 'default')}
          headerContent={landingHeaderContent ?? (hideTiles ? (
            initiative ? (
              <InitiativeOverviewHeader
                initiative={initiative}
                filesUploaded={filesUploaded}
                assessmentsCreated={assessmentsCreated}
                assessmentProgress={assessmentProgress}
                isGenerating={overviewGenerating}
                errorMessage={overviewError}
                onViewAssumptions={onOpenAssumptions}
                healthRefreshToken={healthRefreshToken}
                onOpenDocument={onOpenDocument}
                onOpenWorkspaceAssessment={onOpenWorkspaceAssessment}
              />
            ) : null
          ) : undefined)}
          topRightActions={isOverviewLanding && hideTiles && !landingHeaderContent && initiative ? (
            <>
              <button
                type="button"
                onClick={handleRefreshOverviewPanel}
                disabled={initiative.shared_role === 'viewer' || overviewGenerating}
                className="btn-compact-neutral"
              >
                {overviewGenerating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Refreshing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    Refresh
                  </>
                )}
              </button>
              <Link
                href={`/initiatives/${initiative.id}?view=framework`}
                className="inline-flex items-center justify-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-lg whitespace-nowrap border border-accent bg-accent text-white transition-colors hover:bg-accent-hover hover:border-accent-hover"
              >
                View Framework Plan
              </Link>
            </>
          ) : undefined}
          extraInputActions={composerToolbarLeading}
          topComposerContent={associatedAssessmentsTray}
          inputChips={inputChips}
          hideComposer={hideLandingComposer}
          showAttachments={!allowInitialProjectOnboarding}
          belowComposerContent={
            hideTiles && onOpenWorkspaceAssessment ? (
              <ProjectOutputsSection
                projectId={initiativeId}
                onOpenOutput={onOpenWorkspaceAssessment}
              />
            ) : null
          }
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
      onOpenDocument={onOpenDocument}
      extraInputActions={composerToolbarLeading}
      topComposerContent={associatedAssessmentsTray}
      inputChips={inputChips}
      topContent={topContent}
      topContentMode={topContentMode}
      onApplyProposedValue={handleApplyProposedValue}
      showAttachments={!allowInitialProjectOnboarding}
      showPromoteFinding={showPromoteFinding}
      onPromoteMessage={onPromoteMessage}
      historyLoading={loadingChat}
    />
  );
}

/**
 * @deprecated Use ProjectChatSurface instead.
 */
export const ProjectStandaloneChatView = ProjectChatSurface;
