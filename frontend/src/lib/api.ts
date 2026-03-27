const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Get the current user's ID token for API requests
async function getAuthToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

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
  // Tool-based fields
  project_description: string | null;
  project_type: string | null;
  selected_tools: string[] | null;
  tool_inputs: Record<string, any> | null;
  tool_alignments: Record<string, ToolAlignment> | null;
  deliverables: Record<string, any> | null;
  project_plan: ProjectPlan | null;
  // Sharing fields
  shared_role?: 'editor' | 'viewer' | null;
  owner_email?: string | null;
}

export interface ProjectShare {
  id: string;
  initiative_id: string;
  user_id: string;
  user_email: string | null;
  user_display_name: string | null;
  role: 'editor' | 'viewer';
  created_at: string;
}

export interface UserSearchResult {
  id: string;
  email: string | null;
  display_name: string | null;
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
  /** Internal document ID for citation navigation */
  evidence_doc_id?: string | null;
  /** Chunk position within the document */
  chunk_index?: number | null;
  /** Compare mode: "A" or "B" to attribute to a specific project */
  project_label?: string | null;
}

export interface ResearchStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
}

export interface EvidenceChunkDetail {
  id: string;
  chunk_index: number;
  content: string;
  content_html?: string | null;
  page_number?: number | null;
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
  file_size?: number | null;
  created_at: string;
  chunk_count: number;
}

export interface ProjectMaterial {
  id: string;
  filename: string;
  file_type: string;
  file_size: number | null;
  created_at: string;
  source?: string; // "material" | "evidence"
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
  export_data?: Record<string, unknown> | null;
}

export interface ProjectFilesResponse {
  uploaded: ProjectMaterial[];
  generated: GeneratedFile[];
}

export interface BillingStatus {
  allowed: boolean;
  tier: 'trial' | 'starter' | 'pro' | 'byok' | 'none' | 'unlimited';
  used_usd: number;
  limit_usd: number;
  trial_messages_remaining?: number | null;
  access_code_redeemed?: boolean;
  access_code_available?: boolean;
  status?: string;
}

export interface DriveLinkedFile {
  id: string;
  evidence_doc_id: string | null;
  drive_file_id: string;
  drive_file_name: string;
  drive_mime_type: string;
  drive_modified_time: string;
  last_synced_at: string;
}

export interface DriveImportedFile {
  id: string;
  filename: string;
  file_type: string;
  file_size: number | null;
  created_at: string;
  source: string;
  drive_link_id: string;
  chunk_count: number;
}

export interface DriveImportResult {
  imported: DriveImportedFile[];
  errors: { file_id: string; error: string }[];
}

export interface DriveSyncResult {
  checked: number;
  updated: number;
  errors: { file_id: string; error: string }[];
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
  item_type?: 'deliverable' | 'assessment';
  classification: 'required' | 'optional' | 'unknown';
  status: 'not_started' | 'in_progress' | 'complete';
  rationale: string;
  phase?: string;
  phase_order?: number;
  supports?: string[];
  depends_on?: string[];
}

export interface ProjectPlanPillar {
  id: string;
  name: string;
  summary: string;
  icon?: string;
  items: ProjectPlanItem[];
}

export interface ProjectPlanPhase {
  id: string;
  name: string;
  description?: string;
}

export interface ProjectPlan {
  generated_at: string;
  pillars: ProjectPlanPillar[];
  phases?: ProjectPlanPhase[];
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
  excerpt?: string | null;
  evidence_doc_id?: string | null;
  chunk_id?: string | null;
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

function isDevMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem('nitrogen-settings');
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed?.state?.devMode === true;
  } catch {
    return false;
  }
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  
  // Get auth token
  const token = await getAuthToken();
  const devMode = isDevMode();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (devMode) {
    headers['X-Billing-Test'] = 'true';
  }
  
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    if (response.status === 402 && devMode) {
      const paywall = new CustomEvent('nitrogen:paywall', { detail: error.detail ?? error });
      window.dispatchEvent(paywall);
    }
    throw new Error(error.detail?.message || error.detail || `HTTP ${response.status}`);
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
  
  updateInitiative: (id: string, data: { title?: string; icon?: string }) =>
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

  updateMessageWidget: async (initiativeId: string, messageId: string, widgetData: Record<string, any>) => {
    try {
      return await fetchApi<{ message_id: string; updated: boolean }>(
        `/api/v1/initiatives/${initiativeId}/chat/${messageId}/widget`,
        {
          method: 'PATCH',
          body: JSON.stringify({ widget_data: widgetData }),
        },
      );
    } catch {
      return fetchApi<{ message_id: string; updated: boolean }>(
        `/api/v1/chat/messages/${messageId}/widget`,
        {
          method: 'PATCH',
          body: JSON.stringify({ widget_data: widgetData }),
        },
      );
    }
  },

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
        const body = await response.json().catch(() => null);
        const detail = body?.detail;
        if (detail) throw new Error(detail);
        throw new Error(`Upload failed (${response.status})`);
      }

      return response.json();
    } catch (error) {
      if (error instanceof TypeError && error.message === 'Failed to fetch') {
        throw new Error('Upload failed — could not connect to the server. Check your internet connection and try again.');
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

  downloadExport: async (memoId: string, filename = 'investment_memo.docx') => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(`${API_URL}/api/v1/exports/${memoId}`, { headers });
    
    if (!response.ok) {
      throw new Error('Failed to download export');
    }
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },

  triggerBlobDownload: (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
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

  getEvidenceChunks: (evidenceId: string) =>
    fetchApi<{
      id: string;
      filename: string | null;
      file_type: string | null;
      chunks: EvidenceChunkDetail[];
    }>(`/api/v1/evidence/${evidenceId}/chunks`),

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

  downloadDeliverable: async (initiativeId: string, toolId: string, filename: string) => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(
      `${API_URL}/api/v1/initiatives/${initiativeId}/deliverables/${toolId}/export`,
      { headers }
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Export failed' }));
      throw new Error(err.detail ?? 'Export failed');
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },

  deleteGeneratedFile: async (initiativeId: string, toolId: string) => {
    const token = await getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(
      `${API_URL}/api/v1/initiatives/${initiativeId}/deliverables/${toolId}`,
      { method: 'DELETE', headers }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Delete failed' }));
      throw new Error(error.detail);
    }
    return response.json();
  },

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

  downloadEvidence: async (evidenceId: string, filename: string) => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${API_URL}/api/v1/evidence/${evidenceId}/download`, {
      headers,
    });
    if (!response.ok) {
      throw new Error('Failed to download evidence file');
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

  getEvidenceFileBytes: async (evidenceId: string): Promise<ArrayBuffer> => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${API_URL}/api/v1/evidence/${evidenceId}/download`, {
      headers,
    });
    if (!response.ok) {
      throw new Error('Failed to fetch evidence file');
    }
    return response.arrayBuffer();
  },

  getCorpusFileBytes: async (docId: string): Promise<ArrayBuffer> => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${API_URL}/api/v1/corpus/${docId}/download`, {
      headers,
    });
    if (!response.ok) {
      throw new Error('Failed to fetch corpus file');
    }
    return response.arrayBuffer();
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

  // Chat sessions — optionally scoped to a single project
  getChatSessions: (initiativeId?: string) =>
    fetchApi<{
      sessions: {
        id: string;
        title: string | null;
        created_at: string | null;
        updated_at: string | null;
        message_count: number;
        compare_initiative_ids: string[] | null;
        initiative_id: string | null;
      }[];
    }>(
      initiativeId
        ? `/api/v1/chat/sessions?initiative_id=${encodeURIComponent(initiativeId)}`
        : '/api/v1/chat/sessions',
    ),

  getChatSessionMessages: (sessionId: string) =>
    fetchApi<{
      session_id: string;
      title: string | null;
      messages: ChatMessage[];
    }>(`/api/v1/chat/sessions/${sessionId}/messages`),

  deleteChatSession: (sessionId: string) =>
    fetchApi<{ deleted: boolean; session_id: string }>(
      `/api/v1/chat/sessions/${sessionId}`,
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

  updateChatSessionTitle: (sessionId: string, title: string) =>
    fetchApi<{ session_id: string; title: string }>(
      `/api/v1/chat/sessions/${sessionId}/title`,
      {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      }
    ),

  saveSessionFromMessages: (
    messages: { role: string; content: string; widget_type?: string | null; widget_data?: Record<string, any> | null; sources?: any[] | null; completion_meta?: Record<string, any> | null }[],
    title?: string,
    initiativeId?: string,
  ) =>
    fetchApi<{ session_id: string; title: string | null }>(
      '/api/v1/chat/sessions/save',
      {
        method: 'POST',
        body: JSON.stringify({ title, messages, initiative_id: initiativeId }),
      }
    ),

  confirmChatAlignment: (
    sessionId: string,
    toolId: string,
    sections?: AlignmentSection[],
    parameters?: AlignmentParameter[]
  ) =>
    fetchApi<{
      alignment: ToolAlignment;
      message: string;
      new_messages: {
        id: string;
        role: string;
        content: string;
        widget_type?: string | null;
        widget_data?: Record<string, any> | null;
        created_at?: string | null;
      }[];
    }>(
      `/api/v1/chat/sessions/${sessionId}/alignment/confirm`,
      {
        method: 'POST',
        body: JSON.stringify({
          tool_id: toolId,
          ...(sections && { sections }),
          ...(parameters && { parameters }),
        }),
      }
    ),

  provideChatAlignmentFeedback: (sessionId: string, toolId: string, feedback: string) =>
    fetchApi<{
      alignment: ToolAlignment;
      message: string;
      new_messages: {
        id: string;
        role: string;
        content: string;
        widget_type?: string | null;
        widget_data?: Record<string, any> | null;
        created_at?: string | null;
      }[];
    }>(
      `/api/v1/chat/sessions/${sessionId}/alignment/feedback`,
      {
        method: 'POST',
        body: JSON.stringify({
          tool_id: toolId,
          feedback,
        }),
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
      session_id: string;
      user_message_id: string;
      assistant_message_id: string;
    }) => void,
    onError: (message: string) => void,
    session_id?: string | null,
    toolHint?: string | null,
    modelInputsContext?: string | null,
    initiativeId?: string | null,
    onResearchStep?: (step: ResearchStep) => void,
    compareInitiativeIds?: string[] | null,
  ) => {
    const token = await getAuthToken();
    const devMode = isDevMode();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (devMode) {
      headers['X-Billing-Test'] = 'true';
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
        compare_initiative_ids: compareInitiativeIds ?? null,
      }),
    });

    if (!response.ok || !response.body) {
      const err = await response.json().catch(() => ({ detail: 'Stream failed' }));
      if (response.status === 402 && devMode) {
        const paywall = new CustomEvent('nitrogen:paywall', { detail: err.detail ?? err });
        window.dispatchEvent(paywall);
      }
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

  async getCarbonProjectTypes(): Promise<{ project_types: { value: string; label: string }[] }> {
    return fetchApi('/api/v1/carbon/project-types');
  },

  async switchCarbonMethodPack(
    methodPack: string,
    currentInputs?: Record<string, any>,
  ): Promise<any> {
    return fetchApi('/api/v1/carbon/switch-method-pack', {
      method: 'POST',
      body: JSON.stringify({
        method_pack: methodPack,
        current_inputs: currentInputs,
      }),
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

  // Solar estimate (PVWatts) endpoints
  async recalculateSolar(inputs: Record<string, any>): Promise<any> {
    return fetchApi('/api/v1/pvwatts/recalculate', {
      method: 'POST',
      body: JSON.stringify({ inputs }),
    });
  },

  async updateSolarInput(
    inputs: Record<string, any>,
    fieldName: string,
    value: any,
    status: string = 'confirmed',
  ): Promise<any> {
    return fetchApi('/api/v1/pvwatts/update-input', {
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

  async geocodeSolarAddress(address: string): Promise<any> {
    return fetchApi('/api/v1/pvwatts/geocode', {
      method: 'POST',
      body: JSON.stringify({ address }),
    });
  },

  async autocompleteSolarAddress(query: string): Promise<{ results: Array<{ lat: number; lon: number; display_name: string; zoom?: number }> }> {
    return fetchApi('/api/v1/pvwatts/autocomplete', {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
  },

  async exportSolarExcel(inputs: Record<string, any>, result: Record<string, any>): Promise<Blob> {
    const token = await getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${API_URL}/api/v1/pvwatts/export`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ inputs, result }),
    });
    if (!response.ok) throw new Error(`Export failed: ${response.status}`);
    return response.blob();
  },

  // --- Template Fill ---

  getRecentTemplates: (initiativeId: string, limit = 5) =>
    fetchApi<{ template_id: string; filename: string; file_type: string; created_at: string }[]>(
      `/api/v1/template/recent?initiative_id=${encodeURIComponent(initiativeId)}&limit=${limit}`,
    ),

  uploadTemplate: async (initiativeId: string, file: File): Promise<{ template_id: string; filename: string; file_type: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('initiative_id', initiativeId);
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${API_URL}/api/v1/template/upload`, {
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

  updateTemplateRequirement: (requirementId: string, value?: string | null, reqStatus?: string | null) =>
    fetchApi<{ requirement_id: string; value: string | null; status: string | null; updated: boolean }>(
      `/api/v1/template/requirements/${requirementId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ value: value ?? null, status: reqStatus ?? null }),
      },
    ),

  generateFromTemplate: (initiativeId: string, templateId: string, requirements?: any[]) =>
    fetchApi<{ template_id: string; output_path: string; file_type: string; filename: string; requirements: any[] }>(
      '/api/v1/template/generate',
      {
        method: 'POST',
        body: JSON.stringify({
          initiative_id: initiativeId,
          template_id: templateId,
          requirements: requirements ?? null,
        }),
      },
    ),

  exportTemplate: async (templateId: string, filename: string) => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${API_URL}/api/v1/template/${templateId}/export`, { headers });
    if (!response.ok) throw new Error('Export failed');
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
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

  // ── Sharing ──────────────────────────────────────────────────────
  searchUsers: (q: string): Promise<UserSearchResult[]> =>
    fetchApi<UserSearchResult[]>(`/api/v1/users/search?q=${encodeURIComponent(q)}`),

  getShares: (initiativeId: string): Promise<ProjectShare[]> =>
    fetchApi<ProjectShare[]>(`/api/v1/initiatives/${initiativeId}/shares`),

  createShare: (initiativeId: string, email: string, role: 'editor' | 'viewer'): Promise<ProjectShare> =>
    fetchApi<ProjectShare>(`/api/v1/initiatives/${initiativeId}/shares`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),

  updateShare: (initiativeId: string, shareId: string, role: 'editor' | 'viewer'): Promise<ProjectShare> =>
    fetchApi<ProjectShare>(`/api/v1/initiatives/${initiativeId}/shares/${shareId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  deleteShare: (initiativeId: string, shareId: string): Promise<void> =>
    fetchApi<void>(`/api/v1/initiatives/${initiativeId}/shares/${shareId}`, {
      method: 'DELETE',
    }),

  // ── Google Drive ────────────────────────────────────────────────────────────

  getGoogleAuthUrl: (initiativeId: string) =>
    fetchApi<{ auth_url: string }>(
      '/api/v1/google/connect',
      { method: 'POST', body: JSON.stringify({ initiative_id: initiativeId }) }
    ),

  getGoogleDriveStatus: () =>
    fetchApi<{ connected: boolean; email: string | null }>('/api/v1/google/status'),

  getGoogleDriveAccessToken: () =>
    fetchApi<{ access_token: string }>('/api/v1/google/access-token'),

  disconnectGoogleDrive: () =>
    fetchApi<{ success: boolean }>('/api/v1/google/disconnect', { method: 'DELETE' }),

  importFromDrive: (initiativeId: string, fileIds: string[]) =>
    fetchApi<DriveImportResult>(
      `/api/v1/initiatives/${initiativeId}/drive/import`,
      { method: 'POST', body: JSON.stringify({ file_ids: fileIds }) }
    ),

  getDriveLinkedFiles: (initiativeId: string) =>
    fetchApi<DriveLinkedFile[]>(`/api/v1/initiatives/${initiativeId}/drive/linked`),

  syncDriveFiles: (initiativeId: string) =>
    fetchApi<DriveSyncResult>(
      `/api/v1/initiatives/${initiativeId}/drive/sync`,
      { method: 'POST' }
    ),

  unlinkDriveFile: (initiativeId: string, linkedId: string) =>
    fetchApi<{ success: boolean }>(
      `/api/v1/initiatives/${initiativeId}/drive/linked/${linkedId}`,
      { method: 'DELETE' }
    ),

  // ── Billing ──────────────────────────────────────────────────────

  getBillingStatus: () =>
    fetchApi<BillingStatus>('/api/v1/billing/status'),

  createCheckout: (priceId: string, successUrl: string, cancelUrl: string) =>
    fetchApi<{ url: string }>('/api/v1/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ price_id: priceId, success_url: successUrl, cancel_url: cancelUrl }),
    }),

  createPortalSession: (returnUrl: string) =>
    fetchApi<{ url: string }>('/api/v1/billing/portal', {
      method: 'POST',
      body: JSON.stringify({ return_url: returnUrl }),
    }),

  redeemAccessCode: (code: string) =>
    fetchApi<{ success: boolean; error?: string } & Partial<BillingStatus>>(
      '/api/v1/billing/redeem-code',
      { method: 'POST', body: JSON.stringify({ code }) }
    ),

  // ── API Keys (BYOK) ─────────────────────────────────────────────

  listApiKeys: () =>
    fetchApi<{ provider: string; masked_key: string; created_at: string }[]>(
      '/api/v1/settings/api-keys'
    ),

  storeApiKey: (apiKey: string, provider: string = 'openai') =>
    fetchApi<{ provider: string; masked_key: string; created_at: string }>(
      '/api/v1/settings/api-keys',
      { method: 'POST', body: JSON.stringify({ api_key: apiKey, provider }) }
    ),

  deleteApiKey: (provider: string = 'openai') =>
    fetchApi<{ success: boolean }>(
      `/api/v1/settings/api-keys/${provider}`,
      { method: 'DELETE' }
    ),
};
