import { create } from 'zustand';
import { api, FieldContext, SourceCitation } from '@/lib/api';
import { track } from '@/lib/analytics';
import { MODEL_INPUT_CONTEXT_SOURCES } from '@/first-party/modelInputs';


export interface CompletionMeta {
  latency_ms: number;
  citation_count: number;
  tiers_used: string[];
}

export interface CoreChatMessage {
  id: string;
  /** DB UUID — set after the stream completes and backend has persisted the message */
  db_id?: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceCitation[] | null;
  thinkingLines?: string[];
  completionMeta?: CompletionMeta;
  widget_type?: string | null;
  widget_data?: Record<string, any> | null;
}

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: number;
  messages: CoreChatMessage[];
}

export type ChatSession = ChatSummary;

interface ChatState {
  messages: CoreChatMessage[];
  phase: 'landing' | 'conversation';
  sending: boolean;
  thinkingLines: string[];
  streamingContent: string;
  error: string | null;
  pendingSessionTitle: string | null;
  messageFeedback: Record<string, 'like' | 'dislike' | null>;
  retryingMessageId: string | null;
  /** DB chat UUID — persisted across messages in the same conversation */
  currentChatId: string | null;

  sendMessage: (content: string, toolHint?: string, fieldContext?: FieldContext | null) => Promise<void>;
  editMessage: (messageId: string, newContent: string) => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
  setMessageFeedback: (messageId: string, feedback: 'like' | 'dislike' | null) => void;
  updateMessageWidgetData: (messageId: string, widgetData: Record<string, any>) => void;
  reset: () => void;
}

function buildModelInputsContext(messages: CoreChatMessage[]): string | null {
  const latestByLabel = new Map<string, Record<string, any>>();

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m.widget_type || !m.widget_data) continue;

    for (const source of MODEL_INPUT_CONTEXT_SOURCES) {
      if (!latestByLabel.has(source.label) && source.widgetTypes.includes(m.widget_type)) {
        latestByLabel.set(source.label, m.widget_data);
      }
    }

    if (latestByLabel.size === MODEL_INPUT_CONTEXT_SOURCES.length) break;
  }

  const parts: string[] = [];
  for (const { label } of MODEL_INPUT_CONTEXT_SOURCES) {
    const wd = latestByLabel.get(label);
    if (!wd) continue;
    const inputs = (wd as Record<string, any>).inputs as Record<string, any> | undefined;
    if (!inputs) continue;
    const lines: string[] = [`### ${label} Inputs`];
    for (const [fieldName, inp] of Object.entries(inputs)) {
      const val = inp.value;
      const status = inp.status || 'unknown';
      const unit = inp.unit || '';
      const inpLabel = inp.label || fieldName;
      const valStr = val != null ? `${val}` : '—';
      const prov = (inp as any).provenance || {};
      const derivation: string = prov.derivation || '';
      const rationale: string = prov.rationale || (inp as any).rationale || (inp as any).notes || '';
      let provStr = '';
      if (derivation) provStr += ` derivation=${derivation}`;
      if (rationale) provStr += ` reason="${rationale}"`;
      lines.push(`- ${inpLabel} (field_name=${fieldName}): ${valStr} ${unit} [${status}${provStr}]`);
    }
    const missing = (wd as Record<string, any>).missing_essentials as string[] | undefined;
    if (missing && missing.length > 0) {
      const nice = missing.map((m: string) => (inputs[m] as any)?.label || m);
      lines.push(`⚠ Missing essentials: ${nice.join(', ')}`);
    }
    parts.push(lines.join('\n'));
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

let msgCounter = 0;
function nextId(): string {
  msgCounter += 1;
  return `msg-${Date.now()}-${msgCounter}`;
}

const BLANK_TRANSIENT = {
  sending: false,
  thinkingLines: [] as string[],
  streamingContent: '',
  error: null,
  pendingSessionTitle: null as string | null,
  retryingMessageId: null as string | null,
  currentChatId: null as string | null,
};

export const useChatStore = create<ChatState>()((set, get) => ({
  messages: [],
  phase: 'landing',
  messageFeedback: {},
  ...BLANK_TRANSIENT,

  sendMessage: async (content: string, toolHint?: string, fieldContext?: FieldContext | null) => {
    const state = get();
    if (state.sending) return;

    const isFirst = state.messages.length === 0;

    if (isFirst) {
      api.generateChatTitle(content)
        .then(({ title }) => { if (title) set({ pendingSessionTitle: title }); })
        .catch(() => {/* silently ignore */});
    }

    const userMsgLocalId = nextId();
    const userMsg: CoreChatMessage = {
      id: userMsgLocalId,
      role: 'user',
      content,
    };

    set({
      messages: [...state.messages, userMsg],
      phase: 'conversation',
      sending: true,
      thinkingLines: [],
      streamingContent: '',
      error: null,
    });

    track('chat_message_sent', { is_first: isFirst });

    const history = get().messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const modelInputsContext = buildModelInputsContext(get().messages);

    const assistantLocalId = nextId();

    const thinkingBuffer: string[] = [];
    const wordBuffer: string[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushBuffers = () => {
      flushTimer = null;
      const hasThinking = thinkingBuffer.length > 0;
      const hasWords = wordBuffer.length > 0;
      if (!hasThinking && !hasWords) return;
      const newThinking = hasThinking ? thinkingBuffer.splice(0) : [];
      const newWords = hasWords ? wordBuffer.splice(0) : [];
      set((s) => {
        const updatedThinking = hasThinking ? [...s.thinkingLines, ...newThinking] : s.thinkingLines;
        let updatedContent = s.streamingContent;
        if (hasWords) {
          for (const w of newWords) {
            const sep = !updatedContent || updatedContent.endsWith('\n') ? '' : ' ';
            updatedContent = updatedContent + sep + w;
          }
        }
        return { thinkingLines: updatedThinking, streamingContent: updatedContent };
      });
    };

    const scheduleFlush = () => {
      if (!flushTimer) flushTimer = setTimeout(flushBuffers, 80);
    };

    try {
      await api.sendChatStream(
        history.slice(0, -1),
        content,
        (text) => {
          thinkingBuffer.push(text);
          scheduleFlush();
        },
        (word) => {
          wordBuffer.push(word);
          scheduleFlush();
        },
        (payload) => {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
          flushBuffers();
          const thinkingLines = get().thinkingLines;

          const meta: CompletionMeta = {
            latency_ms: payload.latency_ms,
            citation_count: payload.citation_count,
            tiers_used: payload.tiers_used,
          };

          const assistantMsg: CoreChatMessage = {
            id: assistantLocalId,
            db_id: payload.assistant_message_id,
            role: 'assistant',
            content: payload.content,
            sources: payload.sources,
            thinkingLines,
            completionMeta: meta,
            widget_type: payload.widget_type || null,
            widget_data: payload.widget_data || null,
          };

          set((s) => ({
            messages: [
              ...s.messages.map((m) =>
                m.id === userMsgLocalId ? { ...m, db_id: payload.user_message_id } : m
              ),
              assistantMsg,
            ],
            sending: false,
            streamingContent: '',
            thinkingLines: [],
            currentChatId: payload.chat_id,
          }));

          const pendingTitle = get().pendingSessionTitle;
          if (pendingTitle && payload.chat_id) {
            api.updateChatTitle(payload.chat_id, pendingTitle).catch(() => {});
            set({ pendingSessionTitle: null });
          }

          track('response_completed', {
            latency: payload.latency_ms,
            citation_count: payload.citation_count,
            tiers_used: payload.tiers_used,
          });
        },
        (message) => {
          set({ sending: false, error: message, streamingContent: '' });
        },
        get().currentChatId,
        toolHint,
        null,
        fieldContext ?? null,
        modelInputsContext,
      );
    } catch (err: any) {
      set({
        sending: false,
        error: err.message || 'Something went wrong',
        streamingContent: '',
      });
    }
  },

  editMessage: async (messageId: string, newContent: string) => {
    const { messages } = get();
    const idx = messages.findIndex(m => m.id === messageId);
    if (idx === -1) return;
    set({ messages: messages.slice(0, idx) });
    await get().sendMessage(newContent);
  },

  retryMessage: async (messageId: string) => {
    const { messages } = get();
    const idx = messages.findIndex(m => m.id === messageId);
    if (idx === -1 || messages[idx].role !== 'assistant') return;
    const preceding = messages.slice(0, idx);
    const lastUserMsg = [...preceding].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return;
    set({ messages: preceding, retryingMessageId: messageId });
    await get().sendMessage(lastUserMsg.content);
    set({ retryingMessageId: null });
  },

  setMessageFeedback: (messageId: string, feedback: 'like' | 'dislike' | null) => {
    set(state => ({
      messageFeedback: { ...state.messageFeedback, [messageId]: feedback },
    }));

    const msg = get().messages.find(m => m.id === messageId);
    const dbId = msg?.db_id;
    if (dbId) {
      api.setChatMessageFeedback(dbId, feedback).catch((err) => {
        console.warn('[chatStore] Failed to persist feedback:', err);
        set(state => ({
          messageFeedback: { ...state.messageFeedback, [messageId]: null },
        }));
      });
    }
  },

  updateMessageWidgetData: (messageId: string, widgetData: Record<string, any>) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        (m.id === messageId || m.db_id === messageId)
          ? { ...m, widget_data: widgetData }
          : m
      ),
    }));
  },

  reset: () => {
    set({ messages: [], phase: 'landing', ...BLANK_TRANSIENT });
  },
}));
