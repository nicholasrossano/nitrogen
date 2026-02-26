import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, SourceCitation } from '@/lib/api';
import { track } from '@/lib/analytics';

export interface CompletionMeta {
  latency_ms: number;
  citation_count: number;
  tiers_used: string[];
}

export interface ComplianceChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceCitation[] | null;
  thinkingLines?: string[];
  completionMeta?: CompletionMeta;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  messages: ComplianceChatMessage[];
}

interface ChatState {
  messages: ComplianceChatMessage[];
  phase: 'landing' | 'conversation';
  sending: boolean;
  thinkingLines: string[];
  streamingContent: string;
  error: string | null;
  sessions: ChatSession[];

  sendMessage: (content: string) => Promise<void>;
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
};

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      phase: 'landing',
      sessions: [],
      ...BLANK_TRANSIENT,

      sendMessage: async (content: string) => {
        const state = get();
        if (state.sending) return;

        const isFirst = state.messages.length === 0;

        const userMsg: ComplianceChatMessage = {
          id: nextId(),
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

        const assistantId = nextId();

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

              const assistantMsg: ComplianceChatMessage = {
                id: assistantId,
                role: 'assistant',
                content: payload.content,
                sources: payload.sources,
                thinkingLines,
                completionMeta: meta,
              };

              set((s) => ({
                messages: [...s.messages, assistantMsg],
                sending: false,
                streamingContent: '',
                thinkingLines: [],
              }));

              track('response_completed', {
                latency: payload.latency_ms,
                citation_count: payload.citation_count,
                tiers_used: payload.tiers_used,
              });
            },
            (message) => {
              set({ sending: false, error: message, streamingContent: '' });
            },
          );
        } catch (err: any) {
          set({
            sending: false,
            error: err.message || 'Something went wrong',
            streamingContent: '',
          });
        }
      },

      reset: () => {
        const { messages, sessions } = get();
        const firstUser = messages.find((m) => m.role === 'user');

        if (firstUser) {
          const session: ChatSession = {
            id: `session-${Date.now()}`,
            title: firstUser.content.slice(0, 80),
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
      partialize: (state) => ({ sessions: state.sessions }),
    },
  ),
);
