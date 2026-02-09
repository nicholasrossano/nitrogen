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
  source_type: 'corpus' | 'evidence' | 'web' | 'llm_estimate';
  source_title: string;
  source_url?: string | null;
  chunk_id?: string | null;
  confidence: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  widget_type: string | null;
  widget_data: Record<string, any> | null;
  sources?: SourceCitation[] | null;
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

  sendMessage: (initiativeId: string, content: string) =>
    fetchApi<ChatResponse>(`/api/v1/initiatives/${initiativeId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  sendMessageStream: async (
    initiativeId: string,
    content: string,
    onWord: (word: string) => void,
    onComplete: (message: ChatMessage, stageStatus: any) => void
  ) => {
    // Call the regular API since backend doesn't support streaming yet
    const response = await fetchApi<ChatResponse>(`/api/v1/initiatives/${initiativeId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ content }),
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
};
