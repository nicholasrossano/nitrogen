import { debugChatFlow } from '@/lib/chatDebug';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Get the current user's ID token for API requests.
// Uses authStateReady() so calls made immediately after a page load/redirect
// (e.g. the OAuth callback redirect) still get a token once Firebase has
// restored the session — without blocking after auth state is already known.
async function getAuthToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  try {
    const { getAuth } = await import('firebase/auth');
    const { app } = await import('./firebase');
    const auth = getAuth(app);
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
}

export interface Initiative {
  id: string;
  slug: string;
  user_id: string;
  workspace_id: string;
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
  overview_description: string | null;
  overview_generated_at: string | null;
  selected_tools: string[] | null;
  tool_inputs: Record<string, any> | null;
  deliverables: Record<string, any> | null;
  project_plan: ProjectPlan | null;
  module_instances: ModuleInstance[] | null;
  module_instances_count?: number;
  /** Non-archived module instances with status complete + deliverable (grid tile). */
  generated_modules_count?: number;
  // Sharing fields
  shared_role?: 'editor' | 'viewer' | null;
  owner_email?: string | null;
}

export interface ModuleInstance {
  id: string;
  module_id: string;
  status: 'draft' | 'started' | 'generating' | 'ready' | 'complete' | 'completed' | 'error';
  title: string | null;
  instance_number?: number | null;
  creator_handle?: string | null;
  display_name?: string | null;
  started_by: string;
  started_by_email: string | null;
  started_at: string;
  updated_at: string;
  chat_id: string | null;
  deliverable?: Record<string, any> | null;
  workflow_state?: Record<string, any> | null;
  is_plan_complete?: boolean;
}

export interface ChatModuleSummary {
  instance_id: string;
  module_id: string;
  title: string | null;
  status: string;
  started_at: string | null;
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

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  user_email: string | null;
  user_display_name: string | null;
  role: 'owner' | 'member';
  created_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  icon: string;
  description: string | null;
  workspace_type: 'personal' | 'team';
  current_user_role: 'owner' | 'member';
  created_at: string;
  updated_at: string;
}

export interface WorkspaceDetail extends Workspace {
  members: WorkspaceMember[];
}

export interface UserSearchResult {
  id: string;
  email: string | null;
  display_name: string | null;
}


export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  output_type: string;
  category: string;
}

// ── Assessment Workflow Types ──────────────────────────────────────────────

export type BuildItemOrigin = 'inferred' | 'assumed' | 'provided' | 'researched' | 'user edited';

export interface BuildItemProvenance {
  derivation: string;
  sources: Array<{
    source_type: string;
    source_title: string;
    source_url?: string | null;
    excerpt?: string | null;
    confidence: number;
  }>;
  rationale: string;
}

export interface BuildItem {
  id: string;
  content: Record<string, any>;
  origin: BuildItemOrigin;
  provenance: BuildItemProvenance;
  confirmed: boolean;
  confirmed_at: string | null;
  removable: boolean;
}

export interface BuildStage {
  id: string;
  name: string;
  stage_type: 'widget' | 'simple_list' | 'structured_list' | 'detail_node';
  status: 'pending' | 'generating' | 'in_progress' | 'validated' | 'complete' | 'error';
  widget_type?: string | null;
  widget_data?: Record<string, any> | null;
  items?: BuildItem[] | null;
  view_config?: Record<string, any>;
}

/** @deprecated Use BuildStage instead */
export interface BuildLayer {
  status: 'pending' | 'generating' | 'in_progress' | 'validated' | 'error';
  items: BuildItem[];
}

export interface WorkflowSetup {
  mode?: 'form' | 'auto';
  fields: Record<string, any>;
  confirmed: boolean;
  confirmed_at: string | null;
}

export interface WorkflowBuild {
  stages: BuildStage[];
  current_stage_id: string | null;
}

export interface WorkflowOutput {
  status: 'pending' | 'generating' | 'complete' | 'error';
  content: Record<string, any> | null;
  widget_type?: string | null;
  widget_data?: Record<string, any> | null;
}

export interface WorkflowState {
  module_type: string;
  current_stage: 'setup' | 'build' | 'output';
  setup: WorkflowSetup;
  build: WorkflowBuild;
  output: WorkflowOutput;
}

export interface SetupFieldDef {
  name: string;
  label: string;
  description: string;
  field_type: 'text' | 'textarea' | 'select';
  required: boolean;
  options?: string[] | null;
  placeholder?: string | null;
}

export interface BuildLayerDef {
  id: string;
  name: string;
  view_type: 'simple_list' | 'structured_list' | 'detail_node';
  description: string;
  item_schema: Record<string, any>;
  removable: boolean;
}

export interface WorkflowModuleDefinition extends ModuleDefinition {
  workspace_build_widget?: string | null;
  workspace_output_widget?: string | null;
  setup_fields?: SetupFieldDef[];
  build_layers?: BuildLayerDef[];
}

export interface ModuleWorkflowState {
  instance_id: string;
  module_id: string;
  status: string;
  workflow_state: WorkflowState;
  module_definition: WorkflowModuleDefinition;
}

// ── Unified Staged Workflow Types (new architecture) ──────────────────────

export interface FieldDef {
  name: string;
  field_type: 'text' | 'number' | 'long_text' | 'select';
  required: boolean;
  label: string | null;
  options: string[] | null;
  placeholder: string | null;
}

export interface PopulationStep {
  type: string;
  config: Record<string, any>;
}

export interface StageDef {
  id: string;
  title: string;
  component: 'table' | 'list' | 'record' | 'computed_results';
  widget: string;
  allow_add_rows: boolean;
  fields: FieldDef[];
  population: PopulationStep[];
}

export interface StageState {
  status: 'pending' | 'populating' | 'draft' | 'validated' | 'confirmed' | 'error';
  confirmed_at: string | null;
  confirmed_by: string | null;
  confirmed_by_email?: string | null;
  data: {
    /** For table and list stages */
    items?: BuildItem[];
    /** For record stages */
    source_stage_id?: string;
    records?: Record<string, Record<string, any>>;
    /** For computed_results stages */
    widget_data?: Record<string, any>;
  } | null;
}

export interface FinalApprovalState {
  status: 'pending' | 'approved';
  approved_at: string | null;
  approved_by: string | null;
  approved_by_email: string | null;
}

export interface StagedWorkflowState {
  module_type: string;
  current_stage_id: string | null;
  stages: Record<string, StageState>;
  final_approval: FinalApprovalState;
}

export interface StagedModuleDefinition extends ModuleDefinition {
  export_format: string | null;
  requires_final_approval: boolean;
  stage_defs: StageDef[];
}

export interface StagedModuleWorkflowState {
  instance_id: string;
  module_id: string;
  status: string;
  workflow_version: number;
  workflow_state: StagedWorkflowState;
  module_definition: StagedModuleDefinition;
}

export interface DecisionLogHistoryRow {
  module: string;
  module_id: string;
  module_instance_id: string;
  stage: string;
  stage_id: string;
  entity_type: string;
  entity_id: string;
  item: string;
  current_value: string;
  source_type: string;
  source_detail: string;
  status: string;
  confirmed_by: string;
  confirmed_at: string;
  final_approved_by: string;
  final_approved_at: string;
}

export interface ModuleDecisionLogReport {
  metadata: {
    module_id: string;
    module_name: string;
    module_instance_id: string;
    generated_at: string;
    history_row_count: number;
  };
  history_rows: DecisionLogHistoryRow[];
}

export type AssumptionStatus = 'confirmed' | 'needs_review' | 'missing' | 'rejected';
export type AssumptionSourceType =
  | 'extraction'
  | 'user_input'
  | 'module'
  | 'default'
  | 'missing_placeholder'
  | 'model_candidate';

export interface Assumption {
  id: string;
  initiative_id: string;
  key: string;
  label: string;
  value: any;
  unit: string | null;
  value_type: 'number' | 'string' | 'boolean' | 'percent' | 'currency' | 'text';
  source_type: AssumptionSourceType;
  source_reference: Record<string, any> | null;
  status: AssumptionStatus;
  used_in_modules: string[];
  notes: string | null;
  created_by_email: string | null;
  last_updated_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssumptionSummary {
  total: number;
  confirmed: number;
  needs_review: number;
  missing: number;
  top_attention: Array<Pick<Assumption, 'id' | 'key' | 'label' | 'status' | 'used_in_modules'>>;
}

export interface AssumptionCreateInput {
  key: string;
  label?: string | null;
  value?: any;
  unit?: string | null;
  value_type?: Assumption['value_type'] | null;
  source_type?: AssumptionSourceType;
  source_reference?: Record<string, any> | null;
  status?: AssumptionStatus;
  used_in_modules?: string[];
  notes?: string | null;
}

export interface AssumptionUpdateInput {
  label?: string;
  value?: any;
  unit?: string | null;
  value_type?: Assumption['value_type'];
  source_type?: AssumptionSourceType;
  source_reference?: Record<string, any> | null;
  status?: AssumptionStatus;
  used_in_modules?: string[];
  notes?: string | null;
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
  chunk_kind?: 'text' | 'visual' | string;
  bbox?: Record<string, number> | null;
  preview_image_url?: string | null;
  preview_mime_type?: string | null;
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

export interface FieldContext {
  field_name: string;
  label: string;
  current_value?: number | null;
  unit?: string | null;
  model_type?: 'lcoe' | 'carbon' | 'solar' | null;
  module_id?: string | null;
  status?: string | null;
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

export type EvidenceProcessingStatus =
  | 'uploaded'
  | 'processing'
  | 'lightweight_ready'
  | 'indexed'
  | 'failed';

export interface EvidenceDoc {
  id: string;
  filename: string | null;
  file_type: string | null;
  file_size?: number | null;
  created_at: string;
  chunk_count: number;
  /**
   * Backend processing lifecycle. Clients should prefer this over chunk_count
   * for "is this doc ready?" — chunk_count only becomes non-zero once indexing
   * completes.
   */
  processing_status?: EvidenceProcessingStatus;
  processing_error?: string | null;
}

export interface ProjectMaterial {
  id: string;
  filename: string;
  file_type: string;
  file_size: number | null;
  created_at: string;
  source?: string; // "material" | "evidence"
  processing_status?: EvidenceProcessingStatus;
  processing_error?: string | null;
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
  user_added?: boolean;
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
  plan_type?: string;
  schema_version?: number;
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
  summary_citations?: number[][];
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
    throw new Error(error.detail?.message || error.detail || `HTTP ${response.status}`);
  }

  // 204 No Content and other empty bodies
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

function workflowVersionHeaders(workflowVersion?: number): Record<string, string> | undefined {
  if (workflowVersion === undefined || workflowVersion === null) return undefined;
  return { 'X-Workflow-Version': String(workflowVersion) };
}

export const api = {
  // Initiatives
  listInitiatives: (limit: number = 20, offset: number = 0, archived: boolean = false, workspaceId?: string | null) => {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      archived: String(archived),
    });
    if (workspaceId) params.set('workspace_id', workspaceId);
    return fetchApi<Initiative[]>(`/api/v1/initiatives?${params.toString()}`);
  },

  createInitiative: (title?: string, workspaceId?: string | null) =>
    fetchApi<Initiative>('/api/v1/initiatives', {
      method: 'POST',
      body: JSON.stringify({ title, workspace_id: workspaceId ?? undefined }),
    }),

  listWorkspaces: () =>
    fetchApi<Workspace[]>('/api/v1/workspaces'),

  createWorkspace: (name: string, description?: string | null) =>
    fetchApi<WorkspaceDetail>('/api/v1/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),

  getWorkspace: (workspaceId: string) =>
    fetchApi<WorkspaceDetail>(`/api/v1/workspaces/${workspaceId}`),

  updateWorkspace: (workspaceId: string, data: { name?: string; icon?: string; description?: string | null }) =>
    fetchApi<WorkspaceDetail>(`/api/v1/workspaces/${workspaceId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  addWorkspaceMember: (workspaceId: string, email: string) =>
    fetchApi<WorkspaceMember>(`/api/v1/workspaces/${workspaceId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  removeWorkspaceMember: (workspaceId: string, membershipId: string) =>
    fetchApi<{ success: boolean }>(`/api/v1/workspaces/${workspaceId}/members/${membershipId}`, {
      method: 'DELETE',
    }),

  deleteWorkspace: (workspaceId: string) =>
    fetchApi<void>(`/api/v1/workspaces/${workspaceId}`, {
      method: 'DELETE',
    }),

  getInitiative: (id: string) =>
    fetchApi<Initiative>(`/api/v1/initiatives/${id}`),

  listModuleInstances: (initiativeId: string, options?: { archived?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.archived) params.set('archived', 'true');
    const query = params.toString();
    return fetchApi<ModuleInstance[]>(
      `/api/v1/initiatives/${initiativeId}/modules${query ? `?${query}` : ''}`
    );
  },

  createModuleInstance: (initiativeId: string, moduleId: string) =>
    fetchApi<ModuleInstance>(`/api/v1/initiatives/${initiativeId}/modules`, {
      method: 'POST',
      body: JSON.stringify({ module_id: moduleId }),
    }),

  deleteModuleInstance: (initiativeId: string, instanceId: string) =>
    fetchApi<void>(`/api/v1/initiatives/${initiativeId}/modules/${instanceId}`, {
      method: 'DELETE',
    }),

  restoreModuleInstance: (initiativeId: string, instanceId: string) =>
    fetchApi<ModuleInstance>(`/api/v1/initiatives/${initiativeId}/modules/${instanceId}/restore`, {
      method: 'POST',
    }),

  permanentlyDeleteModuleInstance: (initiativeId: string, instanceId: string) =>
    fetchApi<void>(`/api/v1/initiatives/${initiativeId}/modules/${instanceId}/permanent`, {
      method: 'DELETE',
    }),

  updateInitiative: (id: string, data: { title?: string; icon?: string; workspace_id?: string }) =>
    fetchApi<Initiative>(`/api/v1/initiatives/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  generateInitiativeOverview: (id: string) =>
    fetchApi<Initiative>(`/api/v1/initiatives/${id}/overview`, {
      method: 'POST',
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

  sendMessage: (initiativeId: string, content: string, toolHint?: string, fieldContext?: FieldContext | null) =>
    fetchApi<ChatResponse>(`/api/v1/initiatives/${initiativeId}/chat`, {
      method: 'POST',
      body: JSON.stringify({
        content,
        tool_hint: toolHint ?? null,
        field_context: fieldContext ?? null,
      }),
    }),

  sendMessageStream: async (
    initiativeId: string,
    content: string,
    onWord: (word: string) => void,
    onComplete: (message: ChatMessage, stageStatus: any) => void,
    toolHint?: string,
    fieldContext?: FieldContext | null,
  ) => {
    // Call the regular API since backend doesn't support streaming yet
    const response = await fetchApi<ChatResponse>(`/api/v1/initiatives/${initiativeId}/chat`, {
      method: 'POST',
      body: JSON.stringify({
        content,
        tool_hint: toolHint ?? null,
        field_context: fieldContext ?? null,
      }),
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

  updateMessageWidget: async (initiativeId: string | undefined, messageId: string, widgetData: Record<string, any>) => {
    if (initiativeId) {
      try {
        return await fetchApi<{ message_id: string; updated: boolean }>(
          `/api/v1/initiatives/${initiativeId}/chat/${messageId}/widget`,
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

  uploadWorkspaceEvidence: async (workspaceId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(
      `${API_URL}/api/v1/workspaces/${workspaceId}/evidence`,
      {
        method: 'POST',
        headers,
        body: formData,
      }
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.detail ?? `Upload failed (${response.status})`);
    }
    return response.json() as Promise<{ success: boolean; document: EvidenceDoc; stage: string }>;
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

  getWorkspaceEvidence: (workspaceId: string) =>
    fetchApi<EvidenceDoc[]>(`/api/v1/workspaces/${workspaceId}/evidence`),

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

  getEvidenceChunk: (evidenceId: string, chunkId: string) =>
    fetchApi<{
      id: string;
      filename: string | null;
      file_type: string | null;
      chunk: EvidenceChunkDetail;
    }>(`/api/v1/evidence/${evidenceId}/chunks/${chunkId}`),

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

  getEvidenceChunkPreviewBytes: async (evidenceId: string, chunkId: string): Promise<ArrayBuffer> => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${API_URL}/api/v1/evidence/${evidenceId}/chunks/${chunkId}/preview`, {
      headers,
    });
    if (!response.ok) {
      throw new Error('Failed to fetch evidence chunk preview');
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
    fetchApi<ModuleDefinition[]>('/api/v1/tools'),

  getRecommendedTools: (initiativeId: string) =>
    fetchApi<{
      recommendations: { tool: ModuleDefinition; confidence: number; recommended: boolean }[];
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

  // ── Assessment Workflow ──────────────────────────────────────────

  getModuleWorkflowState: (instanceId: string) =>
    fetchApi<ModuleWorkflowState>(`/api/v1/module-workflow/${instanceId}/state`),

  generateSetupDefaults: (instanceId: string) =>
    fetchApi<{ fields: Record<string, string> }>(
      `/api/v1/module-workflow/${instanceId}/setup/generate`,
      { method: 'POST' }
    ),

  confirmWorkflowSetup: (instanceId: string, fields: Record<string, any>) =>
    fetchApi<{ ok: boolean; current_stage: string }>(
      `/api/v1/module-workflow/${instanceId}/setup/confirm`,
      {
        method: 'POST',
        body: JSON.stringify({ fields }),
      }
    ),

  generateBuildLayer: (instanceId: string, layerId: string) =>
    fetchApi<{ items: BuildItem[]; layer_status: string }>(
      `/api/v1/module-workflow/${instanceId}/build/${layerId}/generate`,
      { method: 'POST' }
    ),

  editBuildItem: (instanceId: string, layerId: string, itemId: string, content: Record<string, any>) =>
    fetchApi<{ item: BuildItem }>(
      `/api/v1/module-workflow/${instanceId}/build/${layerId}/items/${itemId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ content }),
      }
    ),

  confirmBuildItem: (instanceId: string, layerId: string, itemId: string) =>
    fetchApi<{ item: BuildItem; layer_status: string }>(
      `/api/v1/module-workflow/${instanceId}/build/${layerId}/items/${itemId}/confirm`,
      { method: 'POST' }
    ),

  deleteBuildItem: (instanceId: string, layerId: string, itemId: string) =>
    fetchApi<{ ok: boolean; remaining_count: number }>(
      `/api/v1/module-workflow/${instanceId}/build/${layerId}/items/${itemId}`,
      { method: 'DELETE' }
    ),

  addBuildItem: (instanceId: string, layerId: string, content: Record<string, any>) =>
    fetchApi<{ item: BuildItem }>(
      `/api/v1/module-workflow/${instanceId}/build/${layerId}/items`,
      {
        method: 'POST',
        body: JSON.stringify({ content }),
      }
    ),

  reorderBuildItems: (instanceId: string, layerId: string, itemIds: string[]) =>
    fetchApi<{ ok: boolean }>(
      `/api/v1/module-workflow/${instanceId}/build/${layerId}/reorder`,
      {
        method: 'POST',
        body: JSON.stringify({ item_ids: itemIds }),
      }
    ),

  generateWorkflowOutput: (instanceId: string) =>
    fetchApi<{ output: Record<string, any>; status: string }>(
      `/api/v1/module-workflow/${instanceId}/output/generate`,
      { method: 'POST' }
    ),

  persistModuleWorkflowWidget: (instanceId: string, widgetData: Record<string, any>, workflowVersion?: number) =>
    fetchApi<{ instance_id: string; status: string; workflow_state: StagedWorkflowState; workflow_version: number }>(
      `/api/v1/module-workflow/${instanceId}/widget-state`,
      {
        method: 'POST',
        headers: workflowVersionHeaders(workflowVersion),
        body: JSON.stringify({ widget_data: widgetData }),
      }
    ),

  exportModuleOutputDocx: async (instanceId: string): Promise<{ blob: Blob; filename: string }> => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
      `${API_URL}/api/v1/module-workflow/${instanceId}/output/export`,
      { headers }
    );
    if (!res.ok) throw new Error('Export failed');
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    const filename = match ? match[1].replace(/['"]/g, '') : 'assessment.docx';
    const blob = await res.blob();
    return { blob, filename };
  },

  // ── Staged workflow endpoints ──────────────────────────────────────

  getStagedModuleWorkflowState: (instanceId: string) =>
    fetchApi<StagedModuleWorkflowState>(`/api/v1/module-workflow/${instanceId}/state`),

  populateStage: (instanceId: string, stageId: string, workflowVersion?: number) =>
    fetchApi<{ stage_id: string; stage_state: StageState; workflow_state: StagedWorkflowState; workflow_version: number }>(
      `/api/v1/module-workflow/${instanceId}/stages/${stageId}/populate`,
      { method: 'POST', headers: workflowVersionHeaders(workflowVersion) }
    ),

  confirmStage: (instanceId: string, stageId: string, workflowVersion?: number) =>
    fetchApi<{ stage_id: string; stage_state: StageState; workflow_state: StagedWorkflowState; workflow_version: number }>(
      `/api/v1/module-workflow/${instanceId}/stages/${stageId}/confirm`,
      { method: 'POST', headers: workflowVersionHeaders(workflowVersion) }
    ),

  addStageItem: (instanceId: string, stageId: string, content: Record<string, any>, workflowVersion?: number) =>
    fetchApi<{ item: BuildItem; workflow_version: number }>(
      `/api/v1/module-workflow/${instanceId}/stages/${stageId}/items`,
      { method: 'POST', headers: workflowVersionHeaders(workflowVersion), body: JSON.stringify({ content }) }
    ),

  editStageItem: (instanceId: string, stageId: string, itemId: string, content: Record<string, any>, workflowVersion?: number) =>
    fetchApi<{ item: BuildItem; workflow_version: number }>(
      `/api/v1/module-workflow/${instanceId}/stages/${stageId}/items/${itemId}`,
      { method: 'PATCH', headers: workflowVersionHeaders(workflowVersion), body: JSON.stringify({ content }) }
    ),

  deleteStageItem: (instanceId: string, stageId: string, itemId: string, workflowVersion?: number) =>
    fetchApi<{ ok: boolean; remaining_count: number; workflow_version: number }>(
      `/api/v1/module-workflow/${instanceId}/stages/${stageId}/items/${itemId}`,
      { method: 'DELETE', headers: workflowVersionHeaders(workflowVersion) }
    ),

  reorderStageItems: (instanceId: string, stageId: string, itemIds: string[], workflowVersion?: number) =>
    fetchApi<{ ok: boolean; workflow_version: number }>(
      `/api/v1/module-workflow/${instanceId}/stages/${stageId}/reorder`,
      { method: 'POST', headers: workflowVersionHeaders(workflowVersion), body: JSON.stringify({ item_ids: itemIds }) }
    ),

  enrichRecord: (instanceId: string, stageId: string, itemId: string, workflowVersion?: number) =>
    fetchApi<{ item_id: string; record: Record<string, any>; workflow_version: number }>(
      `/api/v1/module-workflow/${instanceId}/stages/${stageId}/records/${itemId}/enrich`,
      { method: 'POST', headers: workflowVersionHeaders(workflowVersion) }
    ),

  enrichStakeholderFromMap: (instanceId: string, itemId: string, workflowVersion?: number) =>
    fetchApi<{ item_id: string; record: Record<string, any>; workflow_version: number }>(
      `/api/v1/module-workflow/${instanceId}/stakeholders/${itemId}/enrich`,
      { method: 'POST', headers: workflowVersionHeaders(workflowVersion) }
    ),

  deepDiveImplementationItem: (
    instanceId: string,
    itemId: string,
    body: {
      item_title: string;
      item_classification: string;
      item_rationale: string;
      pillar_name: string;
    },
    workflowVersion?: number,
  ) =>
    fetchApi<DeepDiveResult>(
      `/api/v1/module-workflow/${instanceId}/implementation/${itemId}/deep-dive`,
      { method: 'POST', headers: workflowVersionHeaders(workflowVersion), body: JSON.stringify(body) }
    ),

  updateRecord: (instanceId: string, stageId: string, itemId: string, fields: Record<string, any>, workflowVersion?: number) =>
    fetchApi<{ item_id: string; record: Record<string, any>; workflow_version: number }>(
      `/api/v1/module-workflow/${instanceId}/stages/${stageId}/records/${itemId}`,
      { method: 'PATCH', headers: workflowVersionHeaders(workflowVersion), body: JSON.stringify({ fields }) }
    ),

  approveFinalModuleOutput: (instanceId: string, workflowVersion?: number) =>
    fetchApi<{ workflow_state: StagedWorkflowState; workflow_version: number }>(
      `/api/v1/module-workflow/${instanceId}/final-approval`,
      { method: 'POST', headers: workflowVersionHeaders(workflowVersion) }
    ),

  revokeFinalModuleApproval: (instanceId: string, workflowVersion?: number) =>
    fetchApi<{ workflow_state: StagedWorkflowState; workflow_version: number }>(
      `/api/v1/module-workflow/${instanceId}/final-approval`,
      { method: 'DELETE', headers: workflowVersionHeaders(workflowVersion) }
    ),

  exportStagedModule: async (instanceId: string): Promise<{ blob: Blob; filename: string }> => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
      `${API_URL}/api/v1/module-workflow/${instanceId}/export`,
      { headers }
    );
    if (!res.ok) throw new Error('Export failed');
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    const filename = match ? match[1].replace(/['"]/g, '') : 'export.docx';
    const blob = await res.blob();
    return { blob, filename };
  },

  exportAssessmentWriteup: async (instanceId: string): Promise<{ blob: Blob; filename: string }> => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
      `${API_URL}/api/v1/module-workflow/${instanceId}/export/writeup`,
      { headers }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).detail ?? 'Write-up export failed');
    }
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    const filename = match ? match[1].replace(/['"]/g, '') : 'writeup.docx';
    const blob = await res.blob();
    return { blob, filename };
  },

  exportAssessmentDecisionLog: async (instanceId: string): Promise<{ blob: Blob; filename: string }> => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
      `${API_URL}/api/v1/module-workflow/${instanceId}/decision-log/export.xlsx`,
      { headers }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).detail ?? 'Decision log export failed');
    }
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    const filename = match ? match[1].replace(/['"]/g, '') : 'decision-log.xlsx';
    const blob = await res.blob();
    return { blob, filename };
  },

  getModuleDecisionLog: (instanceId: string) => {
    return fetchApi<ModuleDecisionLogReport>(`/api/v1/module-workflow/${instanceId}/decision-log`);
  },

  getAssumptionsSummary: (initiativeId: string) =>
    fetchApi<AssumptionSummary>(`/api/v1/initiatives/${initiativeId}/assumptions/summary`),

  listAssumptions: (
    initiativeId: string,
    filters?: { status?: AssumptionStatus | ''; source_type?: AssumptionSourceType | ''; module?: string },
  ) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.source_type) params.set('source_type', filters.source_type);
    if (filters?.module) params.set('module', filters.module);
    const query = params.toString();
    return fetchApi<Assumption[]>(
      `/api/v1/initiatives/${initiativeId}/assumptions${query ? `?${query}` : ''}`,
    );
  },

  createAssumption: (initiativeId: string, data: AssumptionCreateInput) =>
    fetchApi<Assumption>(`/api/v1/initiatives/${initiativeId}/assumptions`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateAssumption: (assumptionId: string, data: AssumptionUpdateInput) =>
    fetchApi<Assumption>(`/api/v1/assumptions/${assumptionId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  refreshAssumptions: (initiativeId: string) =>
    fetchApi<{ created: number; updated: number; assumptions: Assumption[] }>(
      `/api/v1/initiatives/${initiativeId}/assumptions/refresh`,
      { method: 'POST' },
    ),

  exportModuleDecisionLogXlsx: async (instanceId: string): Promise<{ blob: Blob; filename: string }> => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
      `${API_URL}/api/v1/module-workflow/${instanceId}/decision-log/export.xlsx`,
      { headers }
    );
    if (!res.ok) throw new Error('Decision log export failed');
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    const filename = match ? match[1].replace(/['"]/g, '') : 'decision-log.xlsx';
    const blob = await res.blob();
    return { blob, filename };
  },

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

  addPlanItem: (initiativeId: string, pillarId: string, title: string, itemType: 'deliverable' | 'assessment' = 'deliverable', phaseId?: string) =>
    fetchApi<{ success: boolean; item: ProjectPlanItem }>(
      `/api/v1/initiatives/${initiativeId}/project-plan/pillars/${pillarId}/items`,
      {
        method: 'POST',
        body: JSON.stringify({ title, item_type: itemType, ...(phaseId ? { phase_id: phaseId } : {}) }),
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
  getChats: (initiativeId?: string) =>
    fetchApi<{
      chats: {
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
        ? `/api/v1/chats?initiative_id=${encodeURIComponent(initiativeId)}`
        : '/api/v1/chats',
    ),

  getChatMessages: (chatId: string) =>
    fetchApi<{
      chat_id: string;
      title: string | null;
      messages: ChatMessage[];
    }>(`/api/v1/chats/${chatId}/messages`),

  getChatModules: (chatId: string) =>
    fetchApi<{ modules: ChatModuleSummary[] }>(`/api/v1/chats/${chatId}/modules`),

  associateChatModule: (chatId: string, instanceId: string) =>
    fetchApi<{ instance_id: string; chat_id: string; module_id: string }>(
      `/api/v1/chats/${chatId}/modules/${instanceId}`,
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
    initiativeId?: string,
  ) =>
    fetchApi<{ chat_id: string; title: string | null }>(
      '/api/v1/chats/save',
      {
        method: 'POST',
        body: JSON.stringify({ title, messages, initiative_id: initiativeId }),
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
    moduleContext?: { instance_id: string; module_id: string; title?: string | null } | null,
    initiativeId?: string | null,
    onResearchStep?: (step: ResearchStep) => void,
    compareInitiativeIds?: string[] | null,
    allowInitialProjectOnboarding?: boolean,
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

    debugChatFlow('api-send-chat-stream', {
      route: '/api/v1/chat/stream',
      has_project_context: Boolean(projectContext),
      has_field_context: Boolean(fieldContext),
      field_name: fieldContext?.field_name ?? null,
      model_type: fieldContext?.model_type ?? null,
      has_model_inputs_context: Boolean(modelInputsContext),
      has_module_context: Boolean(moduleContext),
      initiative_id: initiativeId ?? null,
      compare_mode: Boolean(compareInitiativeIds?.length),
      allow_initial_project_onboarding: Boolean(allowInitialProjectOnboarding),
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
        module_context: moduleContext ?? null,
        initiative_id: initiativeId ?? null,
        compare_initiative_ids: compareInitiativeIds ?? null,
        allow_initial_project_onboarding: Boolean(allowInitialProjectOnboarding),
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
    status: string = 'validated',
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
    status: string = 'validated',
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
    status: string = 'validated',
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

  importWorkspaceFromDrive: (workspaceId: string, fileIds: string[]) =>
    fetchApi<DriveImportResult>(
      `/api/v1/workspaces/${workspaceId}/drive/import`,
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
