'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { ChatMessage, api } from '@/lib/api';
import { ChatInput } from '@/components/chat/ChatInput';
import ReactMarkdown from 'react-markdown';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useChatTabsStore, ChatTab, ClosedChatTab, ONBOARDING_TAB_ID } from '@/stores/chatTabsStore';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { X, Plus, Clock, Trash2, MessageSquare } from 'lucide-react';
import { UserMessageToolbar, AssistantMessageToolbar } from '@/components/chat/MessageToolbar';
import { MessageVariants } from '@/components/chat/MessageVariants';

import { ConfirmationWidget } from '@/components/widgets/ConfirmationWidget';
import { DocumentRequestWidget } from '@/components/widgets/DocumentRequestWidget';
import { EvidenceInputWidget } from '@/components/widgets/EvidenceInputWidget';
import { GenerateOptionsWidget } from '@/components/widgets/GenerateOptionsWidget';
import { ToolChecklistWidget } from '@/components/widgets/ToolChecklistWidget';
import { DeliverablesOverviewWidget } from '@/components/widgets/DeliverablesOverviewWidget';
import { AlignmentWidget } from '@/components/widgets/AlignmentWidget';
import { ProjectPlanWidget } from '@/components/widgets/ProjectPlanWidget';
import { LCOEInputsWidget } from '@/components/widgets/LCOEInputsWidget';
import { LCOEOutputWidget } from '@/components/widgets/LCOEOutputWidget';
import { CarbonInputsWidget } from '@/components/widgets/CarbonInputsWidget';
import { CarbonOutputWidget } from '@/components/widgets/CarbonOutputWidget';

interface ChatPanelProps {
  messages: ChatMessage[];
  sending: boolean;
  generating: boolean;
  initiativeId: string;
  onSendMessage: (content: string) => void;
  fullWidth?: boolean;
  hasProjectPlan?: boolean;
}

const CHAT_WIDGET_TYPES = [
  'confirmation',
  'evidence_input',
  'generate_options',
  'tool_checklist',
  'deliverables_overview',
  'alignment',
  'project_plan',
  'lcoe_inputs',
  'lcoe_output',
  'carbon_inputs',
  'carbon_output',
];

const ABOVE_INPUT_WIDGET_TYPE = 'document_request';

export function ChatPanel({
  messages,
  sending,
  generating,
  initiativeId,
  onSendMessage,
  fullWidth = false,
  hasProjectPlan = false,
}: ChatPanelProps) {
  const {
    ensureGroup, setActiveTab, createTab, closeTab,
    reopenTab, deleteClosedTab, addMessage,
    removeMessage, setTabTitle,
  } = useChatTabsStore();

  useEffect(() => { ensureGroup(initiativeId); }, [initiativeId, ensureGroup]);

  const group = useChatTabsStore((s) => s.groups[initiativeId]);
  const tabs = useMemo(
    () => group?.tabs ?? [
      { id: ONBOARDING_TAB_ID, title: 'Onboarding', createdAt: 0, isOnboarding: true, messages: [] as ChatMessage[] },
    ],
    [group?.tabs],
  );
  const activeTabId = group?.activeTabId ?? ONBOARDING_TAB_ID;
  const closedTabs = group?.closedTabs ?? [];

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const isOnboardingTab = activeTab?.isOnboarding ?? false;

  const activeMessages = useMemo(
    () => (isOnboardingTab ? messages || [] : activeTab?.messages || []),
    [isOnboardingTab, messages, activeTab?.messages],
  );

  const [tabSending, setTabSending] = useState(false);
  const effectiveSending = isOnboardingTab ? sending : tabSending;
  const effectiveGenerating = isOnboardingTab ? generating : false;

  const [showHistory, setShowHistory] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showHistory) return;
    const handler = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showHistory]);

  // Scroll management
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef<number>(0);
  const prevLastMessageIdRef = useRef<string | null>(null);
  const lastSeenCountRef = useRef<number>(0);
  const isInitialLoadRef = useRef<boolean>(true);

  const safeMessages = useMemo(() => activeMessages || [], [activeMessages]);

  useEffect(() => {
    const lastMessage = safeMessages[safeMessages.length - 1];
    const lastMessageId = lastMessage?.id || null;
    const shouldScroll =
      safeMessages.length > prevMessageCountRef.current ||
      (lastMessageId && lastMessageId !== prevLastMessageIdRef.current);
    if (shouldScroll && scrollContainerRef.current) {
      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
      }, 100);
    }
    prevMessageCountRef.current = safeMessages.length;
    prevLastMessageIdRef.current = lastMessageId;
  }, [safeMessages]);

  useEffect(() => {
    if (safeMessages.length > 0 && isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
    }
    lastSeenCountRef.current = safeMessages.length;
  }, [safeMessages.length]);

  // Reset scroll tracking on tab switch
  useEffect(() => {
    prevMessageCountRef.current = 0;
    prevLastMessageIdRef.current = null;
    isInitialLoadRef.current = true;
    lastSeenCountRef.current = 0;
    if (scrollContainerRef.current) {
      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
      }, 50);
    }
  }, [activeTabId]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      // Pass current initiative messages as snapshot so history is populated
      const snapshot = tab?.isOnboarding ? messages : undefined;
      closeTab(initiativeId, tabId, snapshot);
    },
    [tabs, messages, initiativeId, closeTab],
  );

  // Fire-and-forget: generate an AI title in the background after the first message
  const autoNameTab = useCallback(
    (tabId: string, content: string, isFirst: boolean) => {
      if (!isFirst) return;
      api.generateChatTitle(content)
        .then(({ title }) => { if (title) setTabTitle(initiativeId, tabId, title); })
        .catch(() => {/* silently ignore title failures */});
    },
    [initiativeId, setTabTitle],
  );

  const handleSend = useCallback(
    async (content: string) => {
      if (isOnboardingTab) {
        // Auto-name the onboarding tab after its first user message
        const isFirst = (messages || []).filter((m) => m.role === 'user').length === 0;
        autoNameTab(activeTab.id, content, isFirst);
        onSendMessage(content);
        return;
      }

      const tabId = activeTab.id;
      setTabSending(true);

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        widget_type: null,
        widget_data: null,
        created_at: new Date().toISOString(),
      };

      addMessage(initiativeId, tabId, userMsg);

      const isFirst = !activeTab.messages || activeTab.messages.length === 0;
      autoNameTab(tabId, content, isFirst);

      try {
        const response = await api.sendMessage(initiativeId, content);
        addMessage(initiativeId, tabId, response.message);
      } catch {
        removeMessage(initiativeId, tabId, userMsg.id);
      } finally {
        setTabSending(false);
      }
    },
    [isOnboardingTab, activeTab, messages, initiativeId, onSendMessage, addMessage, removeMessage, autoNameTab],
  );

  const latestMessage = safeMessages[safeMessages.length - 1];
  const showDocumentRequest = latestMessage?.widget_type === ABOVE_INPUT_WIDGET_TYPE;
  const showAlignmentWidget = latestMessage?.widget_type === 'alignment';
  const hideTextInput = showDocumentRequest || showAlignmentWidget;

  return (
    <div className={`flex flex-col h-full overflow-hidden ${fullWidth ? '' : 'border-r border-divider'}`}>
      {/* Tab bar — only shown once a project plan exists */}
      {hasProjectPlan && (
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          closedTabs={closedTabs}
          showHistory={showHistory}
          historyRef={historyRef}
          onSelectTab={(id) => setActiveTab(initiativeId, id)}
          onCloseTab={handleCloseTab}
          onNewTab={() => createTab(initiativeId)}
          onToggleHistory={() => setShowHistory((p) => !p)}
          onReopenTab={(id) => { reopenTab(initiativeId, id); setShowHistory(false); }}
          onDeleteClosedTab={(id) => deleteClosedTab(initiativeId, id)}
        />
      )}

      {/* Messages */}
      <div className="flex-1 relative">
        <div ref={scrollContainerRef} className="absolute inset-0 overflow-y-auto px-4 py-4 space-y-8">
          {safeMessages.length === 0 ? (
            <div className="text-center text-text-tertiary py-8">
              No messages yet. Start a conversation!
            </div>
          ) : (
            safeMessages.map((message, index) => {
              const hasOutputWidget =
                (message.widget_type === 'lcoe_inputs' &&
                  safeMessages.slice(index + 1).some(m => m.widget_type === 'lcoe_output')) ||
                (message.widget_type === 'carbon_inputs' &&
                  safeMessages.slice(index + 1).some(m => m.widget_type === 'carbon_output'));
              return (
                <ErrorBoundary key={message.id || `msg-${index}`}>
                  <ChatMessageItem
                    message={message}
                    initiativeId={initiativeId}
                    isLatest={index === safeMessages.length - 1}
                    animate={!isInitialLoadRef.current && index >= lastSeenCountRef.current}
                    hasOutputWidget={hasOutputWidget}
                    onSendMessage={onSendMessage}
                  />
                </ErrorBoundary>
              );
            })
          )}
          <div ref={messagesEndRef} className="h-1" />
        </div>
      </div>

      {showDocumentRequest && (
        <DocumentRequestWidget
          initiativeId={initiativeId}
          isActive={true}
          data={latestMessage.widget_data ?? undefined}
        />
      )}

      {!hideTextInput && (
        <div className="flex-shrink-0 px-2 pb-4">
          <ChatInput
            onSend={handleSend}
            disabled={effectiveSending || effectiveGenerating}
            placeholder="Ask anything"
          />
        </div>
      )}
    </div>
  );
}

/* ─── Tab bar ─────────────────────────────────────────────────────── */

const ACTIVE_TAB_WIDTH = 136;
const INACTIVE_TAB_MIN_WIDTH = 72;

function TabBar({
  tabs,
  activeTabId,
  closedTabs,
  showHistory,
  historyRef,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onToggleHistory,
  onReopenTab,
  onDeleteClosedTab,
}: {
  tabs: ChatTab[];
  activeTabId: string;
  closedTabs: ClosedChatTab[];
  showHistory: boolean;
  historyRef: React.RefObject<HTMLDivElement>;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onToggleHistory: () => void;
  onReopenTab: (id: string) => void;
  onDeleteClosedTab: (id: string) => void;
}) {
  return (
    <div className="flex-shrink-0 flex items-stretch border-b border-divider bg-surface-subtle/50 h-[36px]">
      {/*
        Scrollable tab area — flex-1 so it fills available width.
        Right controls are flex-shrink-0 and stay pinned.
      */}
      <div
        className="flex-1 flex items-stretch overflow-x-auto min-w-0"
        style={{ scrollbarWidth: 'none' }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <TabButton
              key={tab.id}
              tab={tab}
              isActive={isActive}
              activeWidth={ACTIVE_TAB_WIDTH}
              inactiveMinWidth={INACTIVE_TAB_MIN_WIDTH}
              onClick={() => onSelectTab(tab.id)}
              onClose={() => onCloseTab(tab.id)}
            />
          );
        })}
      </div>

      {/* Fixed right controls */}
      <div className="flex-shrink-0 flex items-center gap-0.5 px-1.5 border-l border-divider">
        <div className="relative" ref={historyRef}>
          <button
            onClick={onToggleHistory}
            className={`
              flex items-center justify-center w-7 h-7 rounded transition-colors
              ${showHistory
                ? 'text-accent bg-accent-wash'
                : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle'}
            `}
            title="Chat history"
          >
            <Clock className="w-3.5 h-3.5" />
          </button>
          {showHistory && (
            <HistoryDropdown
              closedTabs={closedTabs}
              onReopen={onReopenTab}
              onDelete={onDeleteClosedTab}
            />
          )}
        </div>
        <button
          onClick={onNewTab}
          className="flex items-center justify-center w-7 h-7 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
          title="New chat"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ─── Individual tab button ───────────────────────────────────────── */

function TabButton({
  tab,
  isActive,
  activeWidth,
  inactiveMinWidth,
  onClick,
  onClose,
}: {
  tab: ChatTab;
  isActive: boolean;
  activeWidth: number;
  inactiveMinWidth: number;
  onClick: () => void;
  onClose: () => void;
}) {
  const style: React.CSSProperties = isActive
    ? { flexShrink: 0, width: activeWidth }
    : { flex: '1 1 0', minWidth: inactiveMinWidth };

  return (
    <button
      onClick={onClick}
      style={style}
      className={`
        group relative flex items-center gap-1 px-2.5
        text-xs whitespace-nowrap transition-colors
        border-r border-divider last:border-r-0
        ${isActive
          ? 'bg-white text-text-primary font-medium shadow-subtle z-10'
          : 'text-text-tertiary hover:text-text-secondary hover:bg-white/60'}
      `}
    >
      <span className="flex-1 truncate text-left">{tab.title}</span>
      <span
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="
          opacity-0 group-hover:opacity-100 transition-opacity
          p-0.5 rounded hover:bg-black/10 flex-shrink-0
          flex items-center justify-center
        "
      >
        <X className="w-3 h-3" />
      </span>
    </button>
  );
}

/* ─── History dropdown ────────────────────────────────────────────── */

function HistoryDropdown({
  closedTabs,
  onReopen,
  onDelete,
}: {
  closedTabs: ClosedChatTab[];
  onReopen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-divider rounded-lg shadow-lg z-50 overflow-hidden">
      <div className="px-3 py-2 border-b border-divider">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
          Chat History
        </h3>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {closedTabs.length === 0 ? (
          <div className="px-3 py-6 text-xs text-text-tertiary text-center">
            No chat history
          </div>
        ) : (
          closedTabs.map((tab) => (
            <div
              key={tab.id}
              className="group flex items-center gap-2 px-3 py-2.5 hover:bg-surface-subtle cursor-pointer border-b border-divider last:border-b-0 transition-colors"
              onClick={() => onReopen(tab.id)}
            >
              <MessageSquare className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-text-primary truncate">{tab.title}</p>
                <p className="text-[10px] text-text-tertiary mt-0.5">
                  {tab.messages.length} message{tab.messages.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(tab.id); }}
                className="
                  opacity-0 group-hover:opacity-100 transition-opacity
                  p-1 rounded hover:bg-red-50 text-text-tertiary hover:text-red-500 flex-shrink-0
                "
                title="Delete permanently"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ─── Chat message item ───────────────────────────────────────────── */

function ChatMessageItem({
  message,
  initiativeId,
  isLatest,
  animate = false,
  hasOutputWidget = false,
  onSendMessage,
}: {
  message: ChatMessage;
  initiativeId: string;
  isLatest: boolean;
  animate?: boolean;
  hasOutputWidget?: boolean;
  onSendMessage?: (content: string) => void;
}) {
  if (!message) return null;

  const isUser = message.role === 'user';
  const shouldShowWidget =
    message.widget_type &&
    message.widget_data &&
    CHAT_WIDGET_TYPES.includes(message.widget_type);
  const isDocumentRequest = message.widget_type === ABOVE_INPUT_WIDGET_TYPE;
  const enterClass = animate ? (isUser ? 'message-enter' : 'message-enter-bot') : '';

  const {
    messageFeedback,
    messageVariants,
    retryingMessageId,
    editMessage,
    retryMessage,
    setMessageFeedback,
    setVariantIndex,
  } = useInitiativeStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [bubbleWidth, setBubbleWidth] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const feedback = messageFeedback[message.id] ?? null;
  const isRetrying = retryingMessageId === message.id;
  const variantEntry = messageVariants[message.id] ?? null;

  const handleEditStart = useCallback(() => {
    if (bubbleRef.current) {
      setBubbleWidth(bubbleRef.current.offsetWidth);
    }
    setEditValue(message.content);
    setIsEditing(true);
  }, [message.content]);

  const handleEditSave = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === message.content) { setIsEditing(false); return; }
    setIsEditing(false);
    await editMessage(initiativeId, message.id, trimmed);
  }, [editValue, message.content, message.id, initiativeId, editMessage]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
    setEditValue(message.content);
  }, [message.content]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  return (
    <div className={`flex ${enterClass} ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`relative flex flex-col ${isUser ? 'max-w-[90%] items-end' : 'w-full items-start'}`}>

        {/* Floating toolbar */}
        {!isEditing && (
          <div className={`absolute z-10 flex items-center ${isUser ? 'right-0 -bottom-7' : 'left-3 -bottom-7'}`}>
            {isUser ? (
              <UserMessageToolbar content={message.content} onEdit={handleEditStart} />
            ) : (
              <AssistantMessageToolbar
                content={message.content}
                feedback={feedback}
                onFeedback={(f) => setMessageFeedback(message.id, f)}
                onRetry={() => retryMessage(initiativeId, message.id)}
                retrying={isRetrying}
              />
            )}
          </div>
        )}

        {isUser && isEditing ? (
          <div style={bubbleWidth ? { minWidth: bubbleWidth } : undefined}>
            <textarea
              ref={textareaRef}
              value={editValue}
              onChange={e => {
                setEditValue(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditSave(); }
                if (e.key === 'Escape') handleEditCancel();
              }}
              className="w-full text-sm leading-relaxed px-3 py-2 rounded-lg border border-zinc-400 bg-transparent text-text-primary resize-none outline-none focus:border-zinc-500"
            />
            <div className="flex items-center gap-2 mt-1.5 justify-end">
              <button onClick={handleEditCancel} className="text-xs text-text-tertiary hover:text-text-secondary transition-colors">Cancel</button>
              <button onClick={handleEditSave} className="text-xs text-accent hover:text-accent-anchor font-medium transition-colors">Save & regenerate</button>
            </div>
          </div>
        ) : (
          <div ref={isUser ? bubbleRef : undefined} className={`rounded-lg px-3 py-2 text-sm ${isUser ? 'bg-zinc-700 text-white' : 'bg-white text-text-primary'}`}>
            {isUser ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : (
              <div className="prose-sm prose-memo">
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {/* Variant switcher for retried assistant messages */}
        {!isUser && variantEntry && variantEntry.versions.length > 1 && (
          <MessageVariants
            currentIndex={variantEntry.currentIndex}
            total={variantEntry.versions.length}
            onPrev={() => setVariantIndex(message.id, variantEntry.currentIndex - 1)}
            onNext={() => setVariantIndex(message.id, variantEntry.currentIndex + 1)}
          />
        )}

        {shouldShowWidget && !isDocumentRequest && (
          <div className={`mt-3 w-full ${animate ? (isUser ? 'message-widget-enter' : 'message-widget-enter-bot') : ''}`}>
            <ChatWidget
              type={message.widget_type!}
              data={message.widget_data!}
              initiativeId={initiativeId}
              isActive={isLatest}
              hasOutputWidget={hasOutputWidget}
              onSendMessage={onSendMessage}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Chat widget renderer ────────────────────────────────────────── */

function ChatWidget({
  type,
  data,
  initiativeId,
  isActive,
  hasOutputWidget = false,
  onSendMessage,
}: {
  type: string;
  data: Record<string, any>;
  initiativeId: string;
  isActive: boolean;
  hasOutputWidget?: boolean;
  onSendMessage?: (content: string) => void;
}) {
  if (!data) return null;

  switch (type) {
    case 'confirmation':
      return (
        <ErrorBoundary>
          <ConfirmationWidget data={data} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      );
    case 'evidence_input':
      return (
        <ErrorBoundary>
          <EvidenceInputWidget initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      );
    case 'generate_options':
      return (
        <ErrorBoundary>
          <GenerateOptionsWidget data={data} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      );
    case 'tool_checklist':
      return (
        <ErrorBoundary>
          <ToolChecklistWidget data={data} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      );
    case 'deliverables_overview':
      return (
        <ErrorBoundary>
          <DeliverablesOverviewWidget data={data} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      );
    case 'alignment':
      if (!data.alignment || !data.tool) return null;
      return (
        <ErrorBoundary>
          <AlignmentWidget data={data} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      );
    case 'project_plan':
      return (
        <ErrorBoundary>
          <ProjectPlanWidget data={data} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      );
    case 'lcoe_inputs':
      return (
        <ErrorBoundary>
          <LCOEInputsWidget data={data} initiativeId={initiativeId} isActive={isActive} hasOutputWidget={hasOutputWidget} onSendMessage={onSendMessage} />
        </ErrorBoundary>
      );
    case 'lcoe_output':
      return (
        <ErrorBoundary>
          <LCOEOutputWidget data={data} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      );
    case 'carbon_inputs':
      return (
        <ErrorBoundary>
          <CarbonInputsWidget data={data} initiativeId={initiativeId} isActive={isActive} hasOutputWidget={hasOutputWidget} onSendMessage={onSendMessage} />
        </ErrorBoundary>
      );
    case 'carbon_output':
      return (
        <ErrorBoundary>
          <CarbonOutputWidget data={data} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      );
    default:
      return null;
  }
}
