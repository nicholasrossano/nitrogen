const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface Initiative {
  id: string;
  user_id: string;
  title: string | null;
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
  created_at: string;
  updated_at: string;
  // New tool-based fields
  project_description: string | null;
  project_type: string | null;
  selected_tools: string[] | null;
  tool_inputs: Record<string, any> | null;
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

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  widget_type: string | null;
  widget_data: Record<string, any> | null;
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

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  // Initiatives
  listInitiatives: (limit: number = 20, offset: number = 0) =>
    fetchApi<Initiative[]>(`/api/v1/initiatives?limit=${limit}&offset=${offset}`),

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
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Delete failed' }));
      throw new Error(error.detail);
    }
  },

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

  // Evidence
  uploadEvidence: async (initiativeId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(
      `${API_URL}/api/v1/initiatives/${initiativeId}/evidence`,
      {
        method: 'POST',
        body: formData,
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(error.detail);
    }

    return response.json();
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

  downloadExport: (memoId: string) => {
    window.open(`${API_URL}/api/v1/exports/${memoId}`, '_blank');
  },

  getEvidence: (initiativeId: string) =>
    fetchApi<EvidenceDoc[]>(`/api/v1/initiatives/${initiativeId}/evidence`),

  exportChecklist: async (initiativeId: string, content: any) => {
    const response = await fetch(
      `${API_URL}/api/v1/initiatives/${initiativeId}/export-checklist`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
};
