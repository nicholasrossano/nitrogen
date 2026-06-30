export interface Project {
  id: string;
  slug: string;
  user_id: string;
  workspace_id: string;
  title: string | null;
  name: string;
  subject: string | null;
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
  created_by: string;
  created_at: string;
  updated_at: string;
  project_description: string | null;
  project_type: string | null;
  overview_description: string | null;
  overview_generated_at: string | null;
  selected_tools: string[] | null;
  tool_inputs: Record<string, any> | null;
  deliverables: Record<string, any> | null;
  project_plan: ProjectPlan | null;
  assessment_instances: AssessmentInstance[] | null;
  assessment_instances_count?: number;
  generated_assessments_count?: number;
  shared_role?: 'editor' | 'viewer' | null;
  owner_email?: string | null;
}

export interface Finding {
  id: string;
  project_id: string;
  body: string;
  sources: Record<string, unknown>[] | null;
  promoted_by: string;
  source_chat_message_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  promoter_email?: string | null;
}

export interface AssessmentInstance {
  id: string;
  assessment_id: string;
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

export interface ChatAssessmentSummary {
  instance_id: string;
  assessment_id: string;
  title: string | null;
  status: string;
  started_at: string | null;
}

export interface ProjectShare {
  id: string;
  project_id: string;
  user_id: string | null;
  user_email: string | null;
  user_display_name: string | null;
  role: 'editor' | 'viewer';
  created_at: string;
  /** True when the email was invited but no Nitrogen account exists yet. */
  pending?: boolean;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string | null;
  user_email: string | null;
  user_display_name: string | null;
  role: 'owner' | 'member';
  created_at: string;
  /** True when the email was invited but no Nitrogen account exists yet. */
  pending?: boolean;
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

export interface WorkspaceKnowledgeBank {
  id: string;
  workspace_id: string;
  name: string;
  base_url: string;
  is_active: boolean;
  status: 'pending' | 'indexing' | 'ready' | 'failed';
  last_indexed_at: string | null;
  index_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserSearchResult {
  id: string;
  email: string | null;
  display_name: string | null;
}


export interface AssessmentDefinition {
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
  assessment_type: string;
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

export interface WorkflowAssessmentDefinition extends AssessmentDefinition {
  workspace_build_widget?: string | null;
  workspace_output_widget?: string | null;
  setup_fields?: SetupFieldDef[];
  build_layers?: BuildLayerDef[];
}

export interface AssessmentWorkflowState {
  instance_id: string;
  assessment_id: string;
  status: string;
  workflow_state: WorkflowState;
  assessment_definition: WorkflowAssessmentDefinition;
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
  assessment_type: string;
  current_stage_id: string | null;
  stages: Record<string, StageState>;
  final_approval: FinalApprovalState;
  user_engaged?: boolean;
}

export interface StagedAssessmentDefinition extends AssessmentDefinition {
  export_format: string | null;
  requires_final_approval: boolean;
  stage_defs: StageDef[];
}

export interface StagedAssessmentWorkflowState {
  instance_id: string;
  assessment_id: string;
  status: string;
  workflow_version: number;
  workflow_state: StagedWorkflowState;
  assessment_definition: StagedAssessmentDefinition;
}

export interface AssessmentAgentStatus {
  run_state: 'running' | 'needs_review' | 'blocked' | 'approved';
  current_stage_id: string | null;
  current_action: string | null;
  last_summary: string | null;
  workflow_version: number;
  can_resume: boolean;
}

export interface AssessmentActivityLogEntry {
  sequence_number: number;
  event_type: string;
  label: string;
  stage_id: string | null;
  stage_title: string | null;
  summary: string | null;
  occurred_at: string;
  is_decision_point: boolean;
}

export interface AssessmentActivityLog {
  assessment_instance_id: string;
  assessment_id: string;
  run_state: AssessmentAgentStatus['run_state'];
  entries: AssessmentActivityLogEntry[];
}

export interface DecisionLogHistoryRow {
  assessment: string;
  assessment_id: string;
  assessment_instance_id: string;
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

export interface AssessmentDecisionLogReport {
  metadata: {
    assessment_id: string;
    assessment_name: string;
    assessment_instance_id: string;
    generated_at: string;
    history_row_count: number;
  };
  history_rows: DecisionLogHistoryRow[];
}

export type AssumptionStatus = 'validated' | 'extracted' | 'assumed' | 'missing';
export type AssumptionSourceType =
  | 'extraction'
  | 'user_input'
  | 'assessment'
  | 'default'
  | 'missing_placeholder'
  | 'model_candidate'
  | 'promotion';

export interface Assumption {
  id: string;
  project_id: string;
  key: string;
  label: string;
  value: any;
  unit: string | null;
  value_type: 'number' | 'string' | 'boolean' | 'percent' | 'currency' | 'text';
  source_type: AssumptionSourceType;
  source_reference: Record<string, any> | null;
  status: AssumptionStatus;
  used_in_assessments: string[];
  notes: string | null;
  created_by_email: string | null;
  last_updated_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssumptionSummary {
  total: number;
  validated: number;
  extracted: number;
  assumed: number;
  missing: number;
  top_attention: Array<Pick<Assumption, 'id' | 'key' | 'label' | 'status' | 'used_in_assessments'>>;
}

export type ProjectHealthStatus = 'green' | 'yellow' | 'red' | 'unknown';
export type ProjectHealthConfidence = 'high' | 'medium' | 'low' | 'unknown';

export interface ProjectHealthOverride {
  id: string;
  dimension_id: string;
  prior_system_status: ProjectHealthStatus | null;
  override_status: ProjectHealthStatus;
  explanation: string | null;
  overridden_by_email: string | null;
  created_at: string;
}

export interface ProjectHealthSourceReference {
  source_title: string;
  source_type: string;
  source_url?: string | null;
  citation?: string | null;
  evidence_doc_id?: string | null;
  chunk_id?: string | null;
}

export interface ProjectHealthAssessmentReference {
  instance_id: string | null;
  assessment_id: string;
  display_name: string;
}

export interface ProjectHealthDimension {
  dimension_id: string;
  label: string;
  description: string;
  status: ProjectHealthStatus;
  effective_status: ProjectHealthStatus;
  confidence: ProjectHealthConfidence;
  rationale: string;
  critical_insight: string;
  supporting_evidence: string[];
  suggested_improvement: string | null;
  retrieved_sources: ProjectHealthSourceReference[];
  positive_drivers: string[];
  negative_drivers: string[];
  blockers: string[];
  missing_items: string[];
  relevant_modules: string[];
  relevant_module_names: string[];
  relevant_assessments: ProjectHealthAssessmentReference[];
  improvement_actions: string[];
  uncertainties: string[];
  update_source: string;
  last_updated_at: string;
  is_stale: boolean;
  has_override: boolean;
  overrides: ProjectHealthOverride[];
}

export interface ProjectHealthResponse {
  domain: string;
  project_id: string;
  stale: boolean;
  dimensions: ProjectHealthDimension[];
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
  used_in_assessments?: string[];
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
  used_in_assessments?: string[];
  notes?: string | null;
}

export interface AssumptionComment {
  id: string;
  assumption_id: string;
  project_id: string;
  body: string;
  created_by_email: string | null;
  created_at: string;
}

export interface SourceCitation {
  source_type:
    | 'corpus'
    | 'evidence'
    | 'workspace_evidence'
    | 'workspace_knowledge'
    | 'openalex'
    | 'worldbank_indicator'
    | 'worldbank_document'
    | 'worldbank_project'
    | 'iati_activity'
    | 'web'
    | 'llm_estimate';
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
  assessment_id?: string | null;
  status?: string | null;
  assumption_id?: string | null;
}

export interface ActiveEditorContext {
  kind: string;
  title: string;
  evidence_doc_id?: string | null;
  chunk_id?: string | null;
  assessment_id?: string | null;
  instance_id?: string | null;
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
  project_id: string;
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
  tier: 'trial' | 'individual' | 'starter' | 'pro' | 'byok' | 'none' | 'unlimited';
  used_usd: number;
  limit_usd: number;
  trial_messages_remaining?: number | null;
  access_code_redeemed?: boolean;
  access_code_available?: boolean;
  status?: string;
  byok_providers?: string[];
  period_start?: string | null;
  period_end?: string | null;
}

export interface UsageModelBreakdown {
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  call_count: number;
}

export interface UsageDayBreakdown {
  date: string;
  estimated_cost_usd: number;
}

export interface UsageRecentCall {
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  created_at: string;
}

export interface BillingUsageSummary extends BillingStatus {
  total_input_tokens?: number;
  total_output_tokens?: number;
  by_model: UsageModelBreakdown[];
  by_day: UsageDayBreakdown[];
  recent_calls: UsageRecentCall[];
  generated_at?: string;
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
