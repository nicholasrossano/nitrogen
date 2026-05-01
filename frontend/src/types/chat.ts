import type { SourceCitation } from '@/lib/api';

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
  assumptionId?: string | null;
}

export type ChatSession = ChatSummary;
