import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, SourceCitation } from '@/lib/api';
import { track } from '@/lib/analytics';


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

/** @deprecated Use CoreChatMessage */
export type ComplianceChatMessage = CoreChatMessage;

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  messages: CoreChatMessage[];
}

interface ChatState {
  messages: CoreChatMessage[];
  phase: 'landing' | 'conversation';
  sending: boolean;
  thinkingLines: string[];
  streamingContent: string;
  error: string | null;
  sessions: ChatSession[];
  pendingSessionTitle: string | null;
  messageFeedback: Record<string, 'like' | 'dislike' | null>;
  retryingMessageId: string | null;
  /** DB session UUID — persisted across messages in the same conversation */
  currentDbSessionId: string | null;

  sendMessage: (content: string) => Promise<void>;
  editMessage: (messageId: string, newContent: string) => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
  setMessageFeedback: (messageId: string, feedback: 'like' | 'dislike' | null) => void;
  reset: () => void;
  loadSession: (session: ChatSession) => void;
  deleteSession: (id: string) => void;
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
  currentDbSessionId: null as string | null,
};

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      phase: 'landing',
      sessions: [],
      messageFeedback: {},
      ...BLANK_TRANSIENT,

      sendMessage: async (content: string) => {
        const state = get();
        if (state.sending) return;

        const isFirst = state.messages.length === 0;

        // Fire-and-forget: generate AI title in background for first message
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

        const assistantLocalId = nextId();

        try {
          await api.sendComplianceChatStream(
            history.slice(0, -1),
            content,
            (text) => {
              set((s) => ({ thinkingLines: [...s.thinkingLines, text] }));
            },
            (word) => {
              set((s) => {
                const prev = s.streamingContent;
                const separator = !prev || prev.endsWith('\n') ? '' : ' ';
                return { streamingContent: prev + separator + word };
              });
            },
            (payload) => {
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

              // Back-fill db_id on the user message that was just persisted
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
                currentDbSessionId: payload.session_id,
              }));

              // Persist AI-generated title to the session once we have a session_id
              const pendingTitle = get().pendingSessionTitle;
              if (pendingTitle && payload.session_id) {
                api.updateChatSessionTitle(payload.session_id, pendingTitle).catch(() => {});
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
            get().currentDbSessionId,
          );
        } catch (err: any) {
          set({
            sending: false,
            error: err.message || 'Something went wrong',
            streamingContent: '',
          });
        }
      },

      // Edit: truncate from that message onward, then re-send with new content
      editMessage: async (messageId: string, newContent: string) => {
        const { messages } = get();
        const idx = messages.findIndex(m => m.id === messageId);
        if (idx === -1) return;
        // Keep messages before the edited one
        set({ messages: messages.slice(0, idx) });
        await get().sendMessage(newContent);
      },

      // Retry: remove the last assistant message and re-send the preceding user message
      retryMessage: async (messageId: string) => {
        const { messages } = get();
        const idx = messages.findIndex(m => m.id === messageId);
        if (idx === -1 || messages[idx].role !== 'assistant') return;
        // Find the user message that preceded this assistant message
        const preceding = messages.slice(0, idx);
        const lastUserMsg = [...preceding].reverse().find(m => m.role === 'user');
        if (!lastUserMsg) return;
        set({ messages: preceding, retryingMessageId: messageId });
        await get().sendMessage(lastUserMsg.content);
        set({ retryingMessageId: null });
      },

      setMessageFeedback: (messageId: string, feedback: 'like' | 'dislike' | null) => {
        // Optimistic local update
        set(state => ({
          messageFeedback: { ...state.messageFeedback, [messageId]: feedback },
        }));

        // Persist to backend if we have a DB ID for this message
        const msg = get().messages.find(m => m.id === messageId);
        const dbId = msg?.db_id;
        if (dbId) {
          api.setCoreChatMessageFeedback(dbId, feedback).catch((err) => {
            console.warn('[chatStore] Failed to persist feedback:', err);
            // Revert on failure
            set(state => ({
              messageFeedback: { ...state.messageFeedback, [messageId]: null },
            }));
          });
        }
      },

      reset: () => {
        const { messages, sessions, pendingSessionTitle } = get();
        const firstUser = messages.find((m) => m.role === 'user');

        // Deduplicate: check if the current messages are already saved as a session.
        // Compare by message IDs so page refreshes or re-opens don't produce new entries.
        const alreadySaved = firstUser && sessions.some(
          (s) =>
            s.messages.length === messages.length &&
            s.messages.every((m, i) => m.id === messages[i]?.id),
        );

        if (firstUser && !alreadySaved) {
          const session: ChatSession = {
            id: `session-${Date.now()}`,
            title: pendingSessionTitle || firstUser.content.slice(0, 80),
            createdAt: Date.now(),
            messages,
          };
          set({
            sessions: [session, ...sessions].slice(0, 20),
            messages: [],
            phase: 'landing',
            ...BLANK_TRANSIENT,
          });
        } else {
          set({ messages: [], phase: 'landing', ...BLANK_TRANSIENT });
        }
      },

      loadSession: (session: ChatSession) => {
        set({
          messages: session.messages,
          phase: 'conversation',
          ...BLANK_TRANSIENT,
        });
      },

      deleteSession: (id: string) => {
        set((s) => ({ sessions: s.sessions.filter((sess) => sess.id !== id) }));
      },
    }),
    {
      name: 'nitrogen-chat-sessions',
      partialize: (state) => ({
        sessions: state.sessions,
        messages: state.messages,
        phase: state.phase,
      }),
    },
  ),
);
