const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Check if running on localhost in development
function isLocalDevMode(): boolean {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  return (
    process.env.NODE_ENV === 'development' &&
    (hostname === 'localhost' || hostname === '127.0.0.1')
  );
}

// Get the current user's ID token for API requests
async function getAuthToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  
  // In local dev mode, return a mock token that the backend will accept
  if (isLocalDevMode()) {
    return 'REDACTED_DEV_TOKEN';
  }
  
  // In access code bypass mode (production), return mock token
  if (localStorage.getItem('nitrogen_access_granted') === 'true') {
    return 'REDACTED_DEV_TOKEN';
  }
  
  try {
    const { getAuth } = await import('firebase/auth');
    const { app } = await import('./firebase');
    const auth = getAuth(app);
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
}

export interface Initiative {
  id: string;
  user_id: string;
  title: string | null;
  icon: string | null;
  sector: string;
  geography: string | null;
  target_population: string | null;
  goal: string | null;
  budget_range: string | null;
  timeline: string | null;
  constraints: string[] | null;
  stage: string;
  stage_1_complete: boolean;
  evidence_ready: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
  // New tool-based fields
  project_description: string | null;
  project_type: string | null;
  selected_tools: string[] | null;
  tool_inputs: Record<string, any> | null;
  tool_alignments: Record<string, ToolAlignment> | null;
  deliverables: Record<string, any> | null;
  project_plan: ProjectPlan | null;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  output_type: string;
  category: string;
}

export interface SourceCitation {
  source_type: 'corpus' | 'evidence' | 'openalex' | 'web' | 'llm_estimate';
  source_title: string;
  source_url?: string | null;
  chunk_id?: string | null;
  confidence: number;
  /** Journal name (OpenAlex) or domain (web) — used in citation chips */
  publisher?: string | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  widget_type: string | null;
  widget_data: Record<string, any> | null;
  sources?: SourceCitation[] | null;
  thinking_lines?: string[] | null;
  completion_meta?: { latency_ms?: number; citation_count: number; tiers_used: string[] } | null;
  feedback?: 'like' | 'dislike' | null;
  created_at: string;
}

export interface StageStatus {
  stage: string;
  stage_1_complete: boolean;
  evidence_ready: boolean;
  required_fields_complete: boolean;
  missing_fields: string[];
}

export interface ChatResponse {
  message: ChatMessage;
  extracted_fields: Record<string, any> | null;
  stage_status: StageStatus;
  show_confirmation: boolean;
  trigger_tools_next?: boolean;
}

export interface MemoContent {
  title: string;
  date: string;
  executive_summary: string;
  recommendation: 'proceed' | 'hold' | 'reject';
  recommendation_rationale: string;
  evidence_summary: string;
  risks_and_assumptions: string;
  open_questions: string[];
  citations: Citation[];
}

export interface Citation {
  number: number;
  source_type: 'evidence' | 'corpus';
  source_title: string;
  excerpt: string;
  chunk_id: string;
}

export interface MemoResponse {
  id: string;
  initiative_id: string;
  content: MemoContent;
  created_at: string;
}

export interface EvidenceDoc {
  id: string;
  filename: string | null;
  file_type: string | null;
  created_at: string;
  chunk_count: number;
}

export interface ProjectMaterial {
  id: string;
  filename: string;
  file_type: string;
  file_size: number | null;
  created_at: string;
}

export interface GeneratedFile {
  id: string;
  title: string;
  output_type: string;
  created_at: string | null;
  exportable: boolean;
  export_format: string | null;
  exported: boolean;
  download_url: string | null;
}

export interface ProjectFilesResponse {
  uploaded: ProjectMaterial[];
  generated: GeneratedFile[];
}

// Alignment types
export interface AlignmentSection {
  id: string;
  title: string;
  description: string;
  key_points: string[];
  include: boolean;
  order: number;
}

export interface AlignmentParameter {
  name: string;
  label: string;
  description: string;
  param_type: 'text' | 'number' | 'select' | 'boolean';
  value: any;
  options?: string[] | null;
  unit?: string | null;
}

export interface ToolAlignment {
  tool_id: string;
  title: string;
  description: string;
  sections: AlignmentSection[];
  parameters: AlignmentParameter[];
  assumptions: string[];
  confirmed: boolean;
  feedback?: string | null;
}

export interface AlignmentResponse {
  alignment: ToolAlignment;
  message: string;
}

// Plan category proposal types (approval stage)
export interface ProposedCategory {
  id: string;
  name: string;
  summary: string;
  icon?: string;
}

// Project Plan types
export interface ProjectPlanItem {
  id: string;
  title: string;
  classification: 'required' | 'optional' | 'unknown';
  status: 'not_started' | 'in_progress' | 'complete';
  rationale: string;
}

export interface ProjectPlanPillar {
  id: string;
  name: string;
  summary: string;
  icon?: string;
  items: ProjectPlanItem[];
}

export interface ProjectPlan {
  generated_at: string;
  pillars: ProjectPlanPillar[];
  deep_dives?: Record<string, DeepDiveResult>;
}

// Deep Dive types
export interface DeepDiveElement {
  title: string;
  description: string;
  classification: 'required' | 'optional' | 'unknown';
}

export interface DeepDiveDependency {
  condition: string;
  effect: string;
}

export interface DeepDiveSource {
  title: string;
  url: string | null;
  source_type: string;
  publisher: string | null;
}

export interface DeepDiveResult {
  item_id: string;
  item_title: string;
  pillar_name: string;
  what_this_is: string[];
  elements: DeepDiveElement[];
  dependencies: DeepDiveDependency[];
  sources: DeepDiveSource[];
  generated_at: string;
  latency_ms: number;
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  
  // Get auth token
  const token = await getAuthToken();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  
  // Add auth header if token exists
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  // Initiatives
  listInitiatives: (limit: number = 20, offset: number = 0, archived: boolean = false) =>
    fetchApi<Initiative[]>(`/api/v1/initiatives?limit=${limit}&offset=${offset}&archived=${archived}`),

  createInitiative: (title?: string) =>
    fetchApi<Initiative>('/api/v1/initiatives', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  getInitiative: (id: string) =>
    fetchApi<Initiative>(`/api/v1/initiatives/${id}`),
  
  updateInitiative: (id: string, data: { title?: string }) =>
    fetchApi<Initiative>(`/api/v1/initiatives/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteInitiative: async (id: string) => {
    const url = `${API_URL}/api/v1/initiatives/${id}`;
    const token = await getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(url, {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Delete failed' }));
      throw new Error(error.detail);
    }
  },

  permanentlyDeleteInitiative: async (id: string) => {
    const url = `${API_URL}/api/v1/initiatives/${id}/permanent`;
    const token = await getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(url, {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Permanent delete failed' }));
      throw new Error(error.detail);
    }
  },

  restoreInitiative: (id: string) =>
    fetchApi<Initiative>(`/api/v1/initiatives/${id}/restore`, {
      method: 'POST',
    }),

  confirmInitiative: (id: string) =>
    fetchApi<{ success: boolean; stage: string; message: string }>(
      `/api/v1/initiatives/${id}/confirm`,
      { method: 'POST' }
    ),

  // Chat
  getChatHistory: (initiativeId: string) =>
    fetchApi<{ messages: ChatMessage[]; stage_status: StageStatus }>(
      `/api/v1/initiatives/${initiativeId}/chat`
    ),

  sendMessage: (initiativeId: string, content: string, toolHint?: string) =>
    fetchApi<ChatResponse>(`/api/v1/initiatives/${initiativeId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ content, tool_hint: toolHint ?? null }),
    }),

  sendMessageStream: async (
    initiativeId: string,
    content: string,
    onWord: (word: string) => void,
    onComplete: (message: ChatMessage, stageStatus: any) => void,
    toolHint?: string,
  ) => {
    // Call the regular API since backend doesn't support streaming yet
    const response = await fetchApi<ChatResponse>(`/api/v1/initiatives/${initiativeId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ content, tool_hint: toolHint ?? null }),
    });

    // Simulate word-by-word streaming for better UX
    const words = response.message.content.split(' ');
    for (let i = 0; i < words.length; i++) {
      onWord(words[i]);
      // Small delay between words for streaming effect
      await new Promise(resolve => setTimeout(resolve, 30));
    }

    // Call completion callback
    onComplete(response.message, response.stage_status);
  },

  setMessageFeedback: (initiativeId: string, messageId: string, feedback: 'like' | 'dislike' | null) =>
    fetchApi<{ message_id: string; feedback: string | null }>(
      `/api/v1/initiatives/${initiativeId}/chat/${messageId}/feedback`,
      {
        method: 'PATCH',
        body: JSON.stringify({ feedback }),
      }
    ),

  updateMessageWidget: (initiativeId: string, messageId: string, widgetData: Record<string, any>) =>
    fetchApi<{ message_id: string; updated: boolean }>(
      `/api/v1/initiatives/${initiativeId}/chat/${messageId}/widget`,
      {
        method: 'PATCH',
        body: JSON.stringify({ widget_data: widgetData }),
      }
    ),

  truncateChatFrom: (initiativeId: string, fromMessageId: string) =>
    fetchApi<{ deleted_count: number; messages: ChatMessage[] }>(
      `/api/v1/initiatives/${initiativeId}/chat/truncate`,
      {
        method: 'DELETE',
        body: JSON.stringify({ from_message_id: fromMessageId }),
      }
    ),

  retryAssistantMessage: (initiativeId: string, messageId: string) =>
    fetchApi<{ message: ChatMessage; stage_status: StageStatus }>(
      `/api/v1/initiatives/${initiativeId}/chat/retry/${messageId}`,
      { method: 'POST' }
    ),

  // Evidence
  uploadEvidence: async (initiativeId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(
        `${API_URL}/api/v1/initiatives/${initiativeId}/evidence`,
        {
          method: 'POST',
          headers,
          body: formData,
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: `Upload failed with status ${response.status}` }));
        throw new Error(error.detail || `HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      // Provide more detailed error messages
      if (error instanceof TypeError && error.message === 'Failed to fetch') {
        throw new Error('Cannot reach the backend server. Please check if the backend is running on port 8000.');
      }
      throw error;
    }
  },

  pasteEvidence: (initiativeId: string, content: string, title?: string) =>
    fetchApi<{ success: boolean; document: EvidenceDoc; stage: string }>(
      `/api/v1/initiatives/${initiativeId}/evidence/text`,
      {
        method: 'POST',
        body: JSON.stringify({ content, title }),
      }
    ),

  // Generate
  generateMemo: (initiativeId: string, includeCorpus: boolean = true) =>
    fetchApi<MemoResponse>(`/api/v1/initiatives/${initiativeId}/generate`, {
      method: 'POST',
      body: JSON.stringify({ include_corpus: includeCorpus }),
    }),

  getMemo: (initiativeId: string) =>
    fetchApi<MemoResponse>(`/api/v1/initiatives/${initiativeId}/memo`),

  // Export
  exportMemo: (initiativeId: string, memoVersionId?: string) =>
    fetchApi<{ success: boolean; export_id: string; download_url: string; filename: string }>(
      `/api/v1/initiatives/${initiativeId}/export`,
      {
        method: 'POST',
        body: JSON.stringify({ memo_version_id: memoVersionId }),
      }
    ),

  downloadExport: async (memoId: string) => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(`${API_URL}/api/v1/exports/${memoId}`, { headers });
    
    if (!response.ok) {
      throw new Error('Failed to download export');
    }
    
    // Download the file
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'investment_memo.docx';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },

  getEvidence: (initiativeId: string) =>
    fetchApi<EvidenceDoc[]>(`/api/v1/initiatives/${initiativeId}/evidence`),

  getEvidenceContent: (evidenceId: string) =>
    fetchApi<{
      id: string;
      filename: string | null;
      file_type: string | null;
      content: string;
      chunk_count: number;
    }>(`/api/v1/evidence/${evidenceId}/content`),

  deleteEvidence: async (evidenceId: string) => {
    const token = await getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(`${API_URL}/api/v1/evidence/${evidenceId}`, {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Delete failed' }));
      throw new Error(error.detail);
    }
    return response.json();
  },

  // --- Project Materials ---

  uploadMaterial: async (initiativeId: string, file: File): Promise<{ success: boolean; material: ProjectMaterial; message: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${API_URL}/api/v1/initiatives/${initiativeId}/materials`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(error.detail || 'Upload failed');
    }
    return response.json();
  },

  getMaterials: (initiativeId: string) =>
    fetchApi<ProjectMaterial[]>(`/api/v1/initiatives/${initiativeId}/materials`),

  deleteMaterial: async (materialId: string) => {
    const token = await getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${API_URL}/api/v1/materials/${materialId}`, {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Delete failed' }));
      throw new Error(error.detail);
    }
    return response.json();
  },

  getProjectFiles: (initiativeId: string) =>
    fetchApi<ProjectFilesResponse>(`/api/v1/initiatives/${initiativeId}/files`),

  downloadMaterial: async (materialId: string, filename: string) => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${API_URL}/api/v1/materials/${materialId}/download`, {
      headers,
    });
    if (!response.ok) {
      throw new Error('Failed to download file');
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },

  exportChecklist: async (initiativeId: string, content: any) => {
    const token = await getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(
      `${API_URL}/api/v1/initiatives/${initiativeId}/export-checklist`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ content }),
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to export checklist');
    }
    
    // Download the file
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'due_diligence_checklist.xlsx';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },

  // Tools
  getTools: () =>
    fetchApi<ToolDefinition[]>('/api/v1/tools'),

  getRecommendedTools: (initiativeId: string) =>
    fetchApi<{
      recommendations: { tool: ToolDefinition; confidence: number; recommended: boolean }[];
      project_type: string | null;
    }>(`/api/v1/initiatives/${initiativeId}/recommended-tools`),

  selectTools: (initiativeId: string, toolIds: string[]) =>
    fetchApi<{ success: boolean; selected_tools: string[]; stage: string }>(
      `/api/v1/initiatives/${initiativeId}/select-tools`,
      {
        method: 'POST',
        body: JSON.stringify({ tool_ids: toolIds }),
      }
    ),

  updateToolInputs: (initiativeId: string, inputs: Record<string, any>) =>
    fetchApi<{ success: boolean; inputs: Record<string, any>; missing_inputs: Record<string, string[]>; ready_to_generate: boolean }>(
      `/api/v1/initiatives/${initiativeId}/update-inputs`,
      {
        method: 'POST',
        body: JSON.stringify(inputs),
      }
    ),

  generateAllDeliverables: (initiativeId: string) =>
    fetchApi<{ success: boolean; deliverables: Record<string, any> }>(
      `/api/v1/initiatives/${initiativeId}/generate-all`,
      { method: 'POST' }
    ),

  // Alignment
  getAlignment: (initiativeId: string, toolId: string) =>
    fetchApi<{ alignment: ToolAlignment; tool_id: string }>(
      `/api/v1/initiatives/${initiativeId}/alignment/${toolId}`
    ),

  confirmAlignment: (
    initiativeId: string,
    toolId: string,
    sections?: AlignmentSection[],
    parameters?: AlignmentParameter[]
  ) =>
    fetchApi<AlignmentResponse>(
      `/api/v1/initiatives/${initiativeId}/alignment/confirm`,
      {
        method: 'POST',
        body: JSON.stringify({
          tool_id: toolId,
          sections,
          parameters,
        }),
      }
    ),

  provideFeedback: (initiativeId: string, toolId: string, feedback: string) =>
    fetchApi<AlignmentResponse>(
      `/api/v1/initiatives/${initiativeId}/alignment/feedback`,
      {
        method: 'POST',
        body: JSON.stringify({
          tool_id: toolId,
          feedback,
        }),
      }
    ),

  // Project Plan
  getProjectPlan: (initiativeId: string) =>
    fetchApi<{ project_plan: ProjectPlan | null }>(
      `/api/v1/initiatives/${initiativeId}/project-plan`
    ),

  generateProjectPlan: (initiativeId: string) =>
    fetchApi<{ project_plan: ProjectPlan }>(
      `/api/v1/initiatives/${initiativeId}/project-plan`,
      { method: 'POST' }
    ),

  confirmPlanCategories: (initiativeId: string, categories: ProposedCategory[]) =>
    fetchApi<{ project_plan: ProjectPlan }>(
      `/api/v1/initiatives/${initiativeId}/project-plan/confirm-categories`,
      {
        method: 'POST',
        body: JSON.stringify({ categories }),
      }
    ),

  updatePlanItemStatus: (
    initiativeId: string,
    itemId: string,
    status: 'not_started' | 'in_progress' | 'complete',
  ) =>
    fetchApi<{ success: boolean; item_id: string; status: string }>(
      `/api/v1/initiatives/${initiativeId}/project-plan/items/${itemId}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }
    ),

  deletePlanItem: (initiativeId: string, itemId: string) =>
    fetchApi<{ success: boolean; item_id: string }>(
      `/api/v1/initiatives/${initiativeId}/project-plan/items/${itemId}`,
      { method: 'DELETE' }
    ),

  deletePlanElement: (initiativeId: string, itemId: string, elementIndex: number) =>
    fetchApi<{ success: boolean; item_id: string; element_index: number }>(
      `/api/v1/initiatives/${initiativeId}/project-plan/items/${itemId}/elements/${elementIndex}`,
      { method: 'DELETE' }
    ),

  // Project plan deep dive
  deepDiveItem: (
    initiativeId: string,
    itemId: string,
    body: {
      item_title: string;
      item_classification: string;
      item_rationale: string;
      pillar_name: string;
    }
  ) =>
    fetchApi<DeepDiveResult>(
      `/api/v1/initiatives/${initiativeId}/project-plan/items/${itemId}/deep-dive`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    ),

  // Core chat sessions (standalone, not initiative-bound)
  getCoreChatSessions: () =>
    fetchApi<{
      sessions: {
        id: string;
        title: string | null;
        created_at: string | null;
        updated_at: string | null;
        message_count: number;
      }[];
    }>('/api/v1/chat/sessions'),

  getCoreChatSessionMessages: (sessionId: string) =>
    fetchApi<{
      session_id: string;
      title: string | null;
      messages: ChatMessage[];
    }>(`/api/v1/chat/sessions/${sessionId}/messages`),

  deleteCoreChatSession: (sessionId: string) =>
    fetchApi<{ deleted: boolean; session_id: string }>(
      `/api/v1/chat/sessions/${sessionId}`,
      { method: 'DELETE' },
    ),

  setCoreChatMessageFeedback: (messageId: string, feedback: 'like' | 'dislike' | null) =>
    fetchApi<{ message_id: string; feedback: string | null }>(
      `/api/v1/chat/messages/${messageId}/feedback`,
      {
        method: 'PATCH',
        body: JSON.stringify({ feedback }),
      }
    ),

  updateChatSessionTitle: (sessionId: string, title: string) =>
    fetchApi<{ session_id: string; title: string }>(
      `/api/v1/chat/sessions/${sessionId}/title`,
      {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      }
    ),

  sendComplianceChatStream: async (
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
      session_id: string;
      user_message_id: string;
      assistant_message_id: string;
    }) => void,
    onError: (message: string) => void,
    session_id?: string | null,
    toolHint?: string | null,
    modelInputsContext?: string | null,
    initiativeId?: string | null,
  ) => {
    const token = await getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_URL}/api/v1/chat/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content,
        history,
        session_id: session_id ?? null,
        tool_hint: toolHint ?? null,
        model_inputs_context: modelInputsContext ?? null,
        initiative_id: initiativeId ?? null,
      }),
    });

    if (!response.ok || !response.body) {
      const err = await response.json().catch(() => ({ detail: 'Stream failed' }));
      onError(err.detail || `HTTP ${response.status}`);
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

  // Generate a brief 3-5 word title for a chat based on the first message
  generateChatTitle: (message: string) =>
    fetchApi<{ title: string }>('/api/v1/chat/title', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  // LCOE endpoints
  async recalculateLCOE(inputs: Record<string, any>): Promise<any> {
    return fetchApi('/api/v1/lcoe/recalculate', {
      method: 'POST',
      body: JSON.stringify({ inputs }),
    });
  },

  async updateLCOEInput(
    inputs: Record<string, any>,
    fieldName: string,
    value: any,
    status: string = 'confirmed',
  ): Promise<any> {
    return fetchApi('/api/v1/lcoe/update-input', {
      method: 'POST',
      body: JSON.stringify({
        inputs,
        field_name: fieldName,
        value,
        source: 'user',
        status,
      }),
    });
  },

  async getLCOESensitivity(
    inputs: Record<string, any>,
    params?: string[],
  ): Promise<any> {
    return fetchApi('/api/v1/lcoe/sensitivity', {
      method: 'POST',
      body: JSON.stringify({ inputs, params }),
    });
  },

  async exportLCOEExcel(inputs: Record<string, any>): Promise<Blob> {
    const url = `${API_URL}/api/v1/lcoe/export`;
    const token = await getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ inputs }),
    });
    if (!resp.ok) throw new Error('Export failed');
    return resp.blob();
  },

  // Carbon endpoints
  async recalculateCarbon(inputs: Record<string, any>): Promise<any> {
    return fetchApi('/api/v1/carbon/recalculate', {
      method: 'POST',
      body: JSON.stringify({ inputs }),
    });
  },

  async updateCarbonInput(
    inputs: Record<string, any>,
    fieldName: string,
    value: any,
    status: string = 'confirmed',
  ): Promise<any> {
    return fetchApi('/api/v1/carbon/update-input', {
      method: 'POST',
      body: JSON.stringify({
        inputs,
        field_name: fieldName,
        value,
        source: 'user',
        status,
      }),
    });
  },

  async getCarbonSensitivity(
    inputs: Record<string, any>,
    params?: string[],
  ): Promise<any> {
    return fetchApi('/api/v1/carbon/sensitivity', {
      method: 'POST',
      body: JSON.stringify({ inputs, params }),
    });
  },

  async exportCarbonExcel(inputs: Record<string, any>): Promise<Blob> {
    const url = `${API_URL}/api/v1/carbon/export`;
    const token = await getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ inputs }),
    });
    if (!resp.ok) throw new Error('Export failed');
    return resp.blob();
  },

  // --- Gold Standard Certification ---

  async getGSTemplateStatus(): Promise<any> {
    return fetchApi('/api/v1/gs/template/status');
  },

  async getGSTemplatePreview(versionId: string): Promise<any> {
    return fetchApi(`/api/v1/gs/template/${versionId}/preview`);
  },

  async getGSFieldSchema(versionId: string): Promise<any> {
    return fetchApi(`/api/v1/gs/template/${versionId}/fields`);
  },

  async createGSWorkspace(initiativeId?: string, sessionId?: string): Promise<any> {
    return fetchApi('/api/v1/gs/workspace', {
      method: 'POST',
      body: JSON.stringify({ initiative_id: initiativeId, session_id: sessionId }),
    });
  },

  async getGSWorkspace(workspaceId: string): Promise<any> {
    return fetchApi(`/api/v1/gs/workspace/${workspaceId}`);
  },

  async getGSWorkspaceByInitiative(initiativeId: string): Promise<any> {
    return fetchApi(`/api/v1/gs/workspace/by-initiative/${initiativeId}`);
  },

  async getGSWorkspaceBySession(sessionId: string): Promise<any> {
    return fetchApi(`/api/v1/gs/workspace/by-session/${sessionId}`);
  },

  async updateGSFieldValues(workspaceId: string, fields: Record<string, string>): Promise<any> {
    return fetchApi(`/api/v1/gs/workspace/${workspaceId}/fields`, {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
  },

  async getGSFields(workspaceId: string): Promise<any> {
    return fetchApi(`/api/v1/gs/workspace/${workspaceId}/fields`);
  },

  async updateGSChecklistState(workspaceId: string, itemId: string, status: string): Promise<any> {
    return fetchApi(`/api/v1/gs/workspace/${workspaceId}/checklist`, {
      method: 'POST',
      body: JSON.stringify({ item_id: itemId, status }),
    });
  },

  async getGSChecklist(): Promise<any> {
    return fetchApi('/api/v1/gs/checklist');
  },

  async exportGSCoverLetter(workspaceId: string): Promise<Blob> {
    const url = `${API_URL}/api/v1/gs/workspace/${workspaceId}/export`;
    const token = await getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(url, { method: 'POST', headers });
    if (!resp.ok) throw new Error('Export failed');
    return resp.blob();
  },
};
