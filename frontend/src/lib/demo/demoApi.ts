/**
 * Resolves API reads from demo fixtures when demo mode is active.
 * Mutations throw a friendly disabled error (except a few no-op GETs).
 */

import {
  DEMO_INSTANCE_CARBON,
  DEMO_INSTANCE_IMPL,
  DEMO_INSTANCE_LCOE,
  DEMO_INSTANCE_SOLAR,
  DEMO_INSTANCE_STAKEHOLDER,
  buildCarbonWorkflowState,
  buildGenericWorkflowState,
  buildLcoeWorkflowState,
  buildSolarWorkflowState,
  buildStakeholderWorkflowState,
  getDemoStakeholderEnrichment,
  demoActivityLog,
  demoAgentStatus,
  demoAssessmentInstances,
  demoBillingStatus,
  demoChatMessages,
  demoChatMetas,
  demoEvidence,
  demoEvidenceChunks,
  demoEvidenceContent,
  demoFilesResponse,
  demoMaterials,
  demoProject,
  demoProjectStatus,
  demoShares,
  demoVariableComments,
  demoVariableSummary,
  demoVariables,
  demoWorkspace,
  demoWorkspaceDetail,
} from '@/lib/demo/demoFixtures';
import { DEMO_PROJECT_ID, DEMO_WORKSPACE_ID } from '@/lib/demo/demoSession';

const DEMO_DISABLED = 'This action is disabled in the demo. Sign up to build your own project.';

export class DemoDisabledError extends Error {
  constructor(message: string = DEMO_DISABLED) {
    super(message);
    this.name = 'DemoDisabledError';
  }
}

function methodOf(options?: RequestInit): string {
  return (options?.method || 'GET').toUpperCase();
}

function pathOnly(endpoint: string): string {
  const q = endpoint.indexOf('?');
  return q >= 0 ? endpoint.slice(0, q) : endpoint;
}

function searchParams(endpoint: string): URLSearchParams {
  const q = endpoint.indexOf('?');
  return new URLSearchParams(q >= 0 ? endpoint.slice(q + 1) : '');
}

function match(path: string, pattern: RegExp): RegExpMatchArray | null {
  return path.match(pattern);
}

function workflowForInstance(instanceId: string) {
  if (instanceId === DEMO_INSTANCE_LCOE) return buildLcoeWorkflowState();
  if (instanceId === DEMO_INSTANCE_CARBON) return buildCarbonWorkflowState();
  if (instanceId === DEMO_INSTANCE_SOLAR) return buildSolarWorkflowState();
  if (instanceId === DEMO_INSTANCE_STAKEHOLDER) return buildStakeholderWorkflowState();
  if (instanceId === DEMO_INSTANCE_IMPL) {
    return buildGenericWorkflowState(instanceId, 'implementation_plan', 'Implementation Plan', false);
  }
  return null;
}

function isMutation(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

/**
 * Returns fixture data for a demo request, or `undefined` if this request
 * should fall through (should not happen when demo is active — prefer throw).
 */
export function resolveDemoRequest<T>(endpoint: string, options?: RequestInit): T {
  const method = methodOf(options);
  const path = pathOnly(endpoint);
  const params = searchParams(endpoint);

  // --- Workspaces ---
  if (method === 'GET' && path === '/api/v1/workspaces') {
    return [demoWorkspace] as T;
  }
  if (method === 'GET' && path === `/api/v1/workspaces/${DEMO_WORKSPACE_ID}`) {
    return demoWorkspaceDetail as T;
  }
  if (method === 'GET' && path === `/api/v1/workspaces/${DEMO_WORKSPACE_ID}/knowledge-banks`) {
    return [] as T;
  }
  if (method === 'GET' && path === `/api/v1/workspaces/${DEMO_WORKSPACE_ID}/evidence`) {
    return [] as T;
  }

  // --- Projects ---
  if (method === 'GET' && path === '/api/v1/projects') {
    return [demoProject] as T;
  }
  if (method === 'GET' && path === `/api/v1/projects/${DEMO_PROJECT_ID}`) {
    return demoProject as T;
  }
  if (method === 'GET' && path === `/api/v1/projects/${DEMO_PROJECT_ID}/assessments`) {
    return demoAssessmentInstances as T;
  }
  if (method === 'GET' && path === `/api/v1/projects/${DEMO_PROJECT_ID}/project-plan`) {
    return { project_plan: demoProject.project_plan } as T;
  }
  if (method === 'GET' && path === `/api/v1/projects/${DEMO_PROJECT_ID}/project-status`) {
    return demoProjectStatus as T;
  }
  if (method === 'GET' && path === `/api/v1/projects/${DEMO_PROJECT_ID}/project-status/categories`) {
    return demoProjectStatus.categories.map((c, i) => ({
      id: `demo-cat-${i}`,
      category_key: c.category_key,
      label: c.label,
      definition_text: c.definition_text,
      criteria: c.criteria_summary
        ? {
            summary: c.criteria_summary,
            criteria: [],
            retrieval_focus: [],
            parse_warnings: [],
          }
        : null,
      defined_by_email: null,
      is_active: true,
      created_at: demoProject.created_at,
      updated_at: demoProject.updated_at,
    })) as T;
  }
  if (method === 'GET' && path === `/api/v1/projects/${DEMO_PROJECT_ID}/materials`) {
    return demoMaterials as T;
  }
  if (method === 'GET' && path === `/api/v1/projects/${DEMO_PROJECT_ID}/files`) {
    return demoFilesResponse as T;
  }
  if (method === 'GET' && path === `/api/v1/projects/${DEMO_PROJECT_ID}/evidence`) {
    return demoEvidence as T;
  }

  const evidenceChunksMatch = match(path, /^\/api\/v1\/evidence\/([^/]+)\/chunks$/);
  if (method === 'GET' && evidenceChunksMatch) {
    const payload = demoEvidenceChunks(evidenceChunksMatch[1]);
    if (payload) return payload as T;
    throw new Error('Document not found in demo');
  }

  const evidenceChunkMatch = match(path, /^\/api\/v1\/evidence\/([^/]+)\/chunks\/([^/]+)$/);
  if (method === 'GET' && evidenceChunkMatch) {
    const payload = demoEvidenceChunks(evidenceChunkMatch[1]);
    const chunk = payload?.chunks.find((c) => c.id === evidenceChunkMatch[2]) ?? payload?.chunks[0];
    if (payload && chunk) {
      return {
        id: payload.id,
        filename: payload.filename,
        file_type: payload.file_type,
        chunk,
      } as T;
    }
    throw new Error('Document chunk not found in demo');
  }

  const evidenceContentMatch = match(path, /^\/api\/v1\/evidence\/([^/]+)\/content$/);
  if (method === 'GET' && evidenceContentMatch) {
    const payload = demoEvidenceContent(evidenceContentMatch[1]);
    if (payload) return payload as T;
    throw new Error('Document not found in demo');
  }
  if (method === 'GET' && path === `/api/v1/projects/${DEMO_PROJECT_ID}/shares`) {
    return demoShares as T;
  }
  if (method === 'GET' && path === `/api/v1/projects/${DEMO_PROJECT_ID}/drive/linked`) {
    return [] as T;
  }
  if (method === 'GET' && path === `/api/v1/projects/${DEMO_PROJECT_ID}/variables/summary`) {
    return demoVariableSummary as T;
  }
  if (method === 'GET' && path === `/api/v1/projects/${DEMO_PROJECT_ID}/variables`) {
    return demoVariables as T;
  }
  if (method === 'GET' && path === `/api/v1/projects/${DEMO_PROJECT_ID}/recommended-tools`) {
    return {
      recommendations: demoProject.selected_tools?.map((tool) => ({
        tool: { id: tool, name: tool, description: '', icon: '', output_type: '', category: '' },
        confidence: 0.9,
        recommended: true,
      })) ?? [],
      project_type: demoProject.project_type,
    } as T;
  }

  const varMatch = match(path, /^\/api\/v1\/variables\/([^/]+)$/);
  if (method === 'GET' && varMatch) {
    const variable = demoVariables.find((v) => v.id === varMatch[1]);
    if (variable) return variable as T;
    throw new Error('Variable not found in demo');
  }

  const varCommentsMatch = match(path, /^\/api\/v1\/variables\/([^/]+)\/comments$/);
  if (method === 'GET' && varCommentsMatch) {
    return (demoVariableComments[varCommentsMatch[1]] ?? []) as T;
  }

  // --- Chats ---
  if (method === 'GET' && path === '/api/v1/chats') {
    const projectFilter = params.get('project_id');
    const chats = projectFilter && projectFilter !== DEMO_PROJECT_ID
      ? []
      : demoChatMetas;
    return { chats } as T;
  }

  const chatMessagesMatch = match(path, /^\/api\/v1\/chats\/([^/]+)\/messages$/);
  if (method === 'GET' && chatMessagesMatch) {
    const chatId = chatMessagesMatch[1];
    const meta = demoChatMetas.find((c) => c.id === chatId);
    const messages = demoChatMessages[chatId] ?? [];
    return {
      chat_id: chatId,
      title: meta?.title ?? null,
      variable_id: meta?.variable_id ?? null,
      messages,
    } as T;
  }

  const chatAssessmentsMatch = match(path, /^\/api\/v1\/chats\/([^/]+)\/assessments$/);
  if (method === 'GET' && chatAssessmentsMatch) {
    const chatId = chatAssessmentsMatch[1];
    const assessments = demoAssessmentInstances
      .filter((inst) => inst.chat_id === chatId)
      .map((inst) => ({
        instance_id: inst.id,
        assessment_id: inst.assessment_id,
        title: inst.title,
        status: inst.status,
        started_at: inst.started_at,
      }));
    return { assessments } as T;
  }

  // --- Assessment workflow ---
  const wfStateMatch = match(path, /^\/api\/v1\/assessment-workflow\/([^/]+)\/state$/);
  if (method === 'GET' && wfStateMatch) {
    const wf = workflowForInstance(wfStateMatch[1]);
    if (wf) return wf as T;
    throw new Error('Assessment not found in demo');
  }

  const agentMatch = match(path, /^\/api\/v1\/assessment-workflow\/([^/]+)\/agent-status$/);
  if (method === 'GET' && agentMatch) {
    const inst = demoAssessmentInstances.find((i) => i.id === agentMatch[1]);
    // Completed demo assessments stay approved so the workspace does not auto-run the agent.
    return demoAgentStatus(inst ? Boolean(inst.is_plan_complete) : true) as T;
  }

  // No-op agent kick — return static approved/needs_review status instead of throwing.
  const runMatch = match(path, /^\/api\/v1\/assessment-workflow\/([^/]+)\/run$/);
  if (method === 'POST' && runMatch) {
    const inst = demoAssessmentInstances.find((i) => i.id === runMatch[1]);
    return demoAgentStatus(inst ? Boolean(inst.is_plan_complete) : true) as T;
  }

  const logMatch = match(path, /^\/api\/v1\/assessment-workflow\/([^/]+)\/activity-log$/);
  if (method === 'GET' && logMatch) {
    const inst = demoAssessmentInstances.find((i) => i.id === logMatch[1]);
    if (!inst) throw new Error('Assessment not found in demo');
    return demoActivityLog(inst.id, inst.assessment_id, Boolean(inst.is_plan_complete)) as T;
  }

  // --- Billing / Google ---
  if (method === 'GET' && path === '/api/v1/billing/status') {
    return demoBillingStatus as T;
  }
  if (method === 'GET' && path === '/api/v1/billing/usage') {
    return {
      ...demoBillingStatus,
      by_model: [],
      by_day: [],
      recent_calls: [],
    } as T;
  }
  if (method === 'GET' && path === '/api/v1/billing/catalog') {
    return {
      billing_enabled: false,
      subscription_price_usd: 0,
      subscription_usage_limit_usd: 0,
      usage_budget_buffer_pct: 0,
      stripe_price_id: null,
    } as T;
  }
  if (method === 'GET' && path === '/api/v1/google/status') {
    return { connected: false, email: null } as T;
  }

  // Chat title generation — harmless no-op for demo sends
  if (method === 'POST' && path === '/api/v1/chat/title') {
    return { title: 'Demo conversation' } as T;
  }

  // Stakeholder map deep-dive / enrich — return pre-built profiles instead of blocking.
  const stakeholderEnrich = match(
    path,
    /^\/api\/v1\/assessment-workflow\/([^/]+)\/stakeholders\/([^/]+)\/enrich$/,
  );
  if (method === 'POST' && stakeholderEnrich) {
    const enrichment = getDemoStakeholderEnrichment(stakeholderEnrich[2]);
    if (enrichment) return enrichment as T;
    throw new DemoDisabledError();
  }

  if (isMutation(method)) {
    throw new DemoDisabledError();
  }

  // Unknown GET — empty-ish defaults so chrome does not hard-crash
  if (path.includes('/variables')) return [] as T;
  if (path.endsWith('/shares')) return [] as T;
  if (path.includes('/evidence') || path.includes('/materials') || path.includes('/files')) {
    return (path.includes('/files') ? { uploaded: [], generated: [] } : []) as T;
  }
  if (path.includes('/chats')) return { chats: [] } as T;
  if (path.includes('/workspaces')) return [] as T;
  if (path.includes('/projects') && !path.includes(DEMO_PROJECT_ID)) {
    // Asking for a non-demo project while in demo
    throw new DemoDisabledError('Only the demo project is available in demo mode.');
  }

  console.warn('[demo] Unhandled GET', method, endpoint);
  return undefined as T;
}

export function tryResolveDemoRequest<T>(endpoint: string, options?: RequestInit): T {
  return resolveDemoRequest<T>(endpoint, options);
}
