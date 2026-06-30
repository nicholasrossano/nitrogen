import {
  API_URL,
  fetchApi,
  fetchApiWithTimeout,
  getAuthToken,
  triggerBlobDownload,
  workflowVersionHeaders,
} from './client';
import type {
  Project,
  ChatAssessmentSummary,
  SourceCitation,
  ResearchStep,
  ChatMessage,
  FieldContext,
  ActiveEditorContext,
} from './types';

import { debugChatFlow } from '@/lib/chatDebug';
import { isStoredFeatureFlagEnabled } from '@/lib/featureFlags';


export const chatApi = {
  updateMessageWidget: async (projectId: string | undefined, messageId: string, widgetData: Record<string, any>) => {
    if (projectId) {
      try {
        return await fetchApi<{ message_id: string; updated: boolean }>(
          `/api/v1/projects/${projectId}/chat/${messageId}/widget`,
          {
            method: 'PATCH',
            body: JSON.stringify({ widget_data: widgetData }),
          },
        );
      } catch {
        // Project chats use the core chat table; fall back to that endpoint.
      }
    }

    return fetchApi<{ message_id: string; updated: boolean }>(
      `/api/v1/chat/messages/${messageId}/widget`,
      {
        method: 'PATCH',
        body: JSON.stringify({ widget_data: widgetData }),
      },
    );
  },

  // Evidence,
  getChats: (projectId?: string) =>
    fetchApi<{
      chats: {
        id: string;
        title: string | null;
        created_at: string | null;
        updated_at: string | null;
        message_count: number;
        compare_project_ids: string[] | null;
        project_id: string | null;
        assumption_id: string | null;
      }[];
    }>(
      (() => {
        const params = new URLSearchParams();
        if (projectId) params.set('project_id', projectId);
        const qs = params.toString();
        return qs ? `/api/v1/chats?${qs}` : '/api/v1/chats';
      })(),
    ),
  getChatMessages: (chatId: string) =>
    fetchApi<{
      chat_id: string;
      title: string | null;
      assumption_id: string | null;
      messages: ChatMessage[];
    }>(`/api/v1/chats/${chatId}/messages`),
  getChatAssessments: (chatId: string) =>
    fetchApi<{ assessments: ChatAssessmentSummary[] }>(`/api/v1/chats/${chatId}/assessments`),
  associateChatAssessment: (chatId: string, instanceId: string) =>
    fetchApi<{ instance_id: string; chat_id: string; assessment_id: string }>(
      `/api/v1/chats/${chatId}/assessments/${instanceId}`,
      { method: 'POST' },
    ),
  deleteChat: (chatId: string) =>
    fetchApi<{ deleted: boolean; chat_id: string }>(
      `/api/v1/chats/${chatId}`,
      { method: 'DELETE' },
    ),
  setChatMessageFeedback: (messageId: string, feedback: 'like' | 'dislike' | null) =>
    fetchApi<{ message_id: string; feedback: string | null }>(
      `/api/v1/chat/messages/${messageId}/feedback`,
      {
        method: 'PATCH',
        body: JSON.stringify({ feedback }),
      }
    ),
  updateChatTitle: (chatId: string, title: string) =>
    fetchApi<{ chat_id: string; title: string }>(
      `/api/v1/chats/${chatId}/title`,
      {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      }
    ),
  saveChatFromMessages: (
    messages: { role: string; content: string; widget_type?: string | null; widget_data?: Record<string, any> | null; sources?: any[] | null; completion_meta?: Record<string, any> | null }[],
    title?: string,
    projectId?: string,
  ) =>
    fetchApi<{ chat_id: string; title: string | null }>(
      '/api/v1/chats/save',
      {
        method: 'POST',
        body: JSON.stringify({ title, messages, project_id: projectId }),
      }
    ),
  sendChatStream: async (
    history: { role: string; content: string }[],
    content: string,
    onThinking: (text: string) => void,
    onWord: (word: string) => void,
    onComplete: (payload: {
      content: string;
      sources: SourceCitation[];
      tiers_used: string[];
      citation_count: number;
      latency_ms: number;
      widget_type?: string | null;
      widget_data?: Record<string, any> | null;
      thinking_lines?: string[];
      chat_id: string;
      user_message_id: string;
      assistant_message_id: string;
    }) => void,
    onError: (message: string) => void,
    chat_id?: string | null,
    toolHint?: string | null,
    projectContext?: string | null,
    fieldContext?: FieldContext | null,
    modelInputsContext?: string | null,
    assessmentContext?: { instance_id: string; assessment_id: string; title?: string | null } | null,
    projectId?: string | null,
    assumptionId?: string | null,
    onResearchStep?: (step: ResearchStep) => void,
    compareProjectIds?: string[] | null,
    allowInitialProjectOnboarding?: boolean,
    activeEditorContext?: ActiveEditorContext | null,
  ) => {
    const token = await getAuthToken();
    const useBillingTestHeaders = isStoredFeatureFlagEnabled('billing_test_headers');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (useBillingTestHeaders) {
      headers['X-Billing-Test'] = 'true';
    }

    debugChatFlow('api-send-chat-stream', {
      route: '/api/v1/chat/stream',
      has_project_context: Boolean(projectContext),
      has_field_context: Boolean(fieldContext),
      field_name: fieldContext?.field_name ?? null,
      model_type: fieldContext?.model_type ?? null,
      has_model_inputs_context: Boolean(modelInputsContext),
      has_assessment_context: Boolean(assessmentContext),
      project_id: projectId ?? null,
      assumption_id: assumptionId ?? null,
      compare_mode: Boolean(compareProjectIds?.length),
      allow_initial_project_onboarding: Boolean(allowInitialProjectOnboarding),
      has_active_editor_context: Boolean(activeEditorContext),
      active_editor_kind: activeEditorContext?.kind ?? null,
    });

    const response = await fetch(`${API_URL}/api/v1/chat/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content,
        history,
        chat_id: chat_id ?? null,
        tool_hint: toolHint ?? null,
        project_context: projectContext ?? null,
        field_context: fieldContext ?? null,
        model_inputs_context: modelInputsContext ?? null,
        assessment_context: assessmentContext ?? null,
        project_id: projectId ?? null,
        assumption_id: assumptionId ?? null,
        compare_project_ids: compareProjectIds ?? null,
        allow_initial_project_onboarding: Boolean(allowInitialProjectOnboarding),
        active_editor_context: activeEditorContext ?? null,
      }),
    });

    if (!response.ok || !response.body) {
      const err = await response.json().catch(() => ({ detail: 'Stream failed' }));
      onError(err.detail?.message || err.detail || `HTTP ${response.status}`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) return;
      const json_str = trimmed.slice(6);
      if (!json_str) return;

      try {
        const event = JSON.parse(json_str);
        switch (event.type) {
          case 'thinking':
            onThinking(event.text);
            break;
          case 'research_step':
            if (onResearchStep) {
              onResearchStep({ id: event.id, label: event.label, status: event.status });
            }
            break;
          case 'word':
            onWord(event.content);
            break;
          case 'complete':
            onComplete(event);
            break;
          case 'error':
            onError(event.message);
            break;
        }
      } catch (e) {
        console.warn('[SSE] Failed to parse:', json_str.slice(0, 100), e);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        processLine(line);
      }
    }

    // Flush remaining buffer after stream closes
    buffer += decoder.decode();
    if (buffer.trim()) {
      processLine(buffer);
    }
  },

  // Generate a brief 3-5 word title for a chat based on the first message,
  generateChatTitle: (message: string) =>
    fetchApi<{ title: string }>('/api/v1/chat/title', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  // LCOE endpoints,
};
