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
  Finding,
  AssessmentInstance,
  AssessmentDefinition,
  ProjectHealthStatus,
  ProjectHealthResponse,
  MemoResponse,
  ProjectPlanItem,
  ProjectPlan,
  DeepDiveResult,
} from './types';



export const projectsApi = {
  listProjects: (limit: number = 50, offset: number = 0, archived: boolean = false, workspaceId?: string | null) => {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      archived: String(archived),
    });
    if (workspaceId) params.set('workspace_id', workspaceId);
    return fetchApi<Project[]>(`/api/v1/projects?${params.toString()}`);
  },
  createProject: (title?: string, workspaceId?: string | null) =>
    fetchApi<Project>('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ title, workspace_id: workspaceId ?? undefined }),
    }),
  listProjectFindings: (projectId: string) =>
    fetchApi<{ findings: Finding[] }>(`/api/v1/projects/${projectId}/findings`),
  promoteFinding: (payload: {
    chat_message_id: string;
    project_id: string;
    body?: string;
  }) =>
    fetchApi<Finding>('/api/v1/findings/promote', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getProject: (id: string) =>
    fetchApi<Project>(`/api/v1/projects/${id}`),
  listAssessmentInstances: (projectId: string, options?: { archived?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.archived) params.set('archived', 'true');
    const query = params.toString();
    return fetchApi<AssessmentInstance[]>(
      `/api/v1/projects/${projectId}/assessments${query ? `?${query}` : ''}`
    );
  },
  createAssessmentInstance: (projectId: string, assessmentId: string) =>
    fetchApi<AssessmentInstance>(`/api/v1/projects/${projectId}/assessments`, {
      method: 'POST',
      body: JSON.stringify({ assessment_id: assessmentId }),
    }),
  deleteAssessmentInstance: (projectId: string, instanceId: string) =>
    fetchApi<void>(`/api/v1/projects/${projectId}/assessments/${instanceId}`, {
      method: 'DELETE',
    }),
  restoreAssessmentInstance: (projectId: string, instanceId: string) =>
    fetchApi<AssessmentInstance>(`/api/v1/projects/${projectId}/assessments/${instanceId}/restore`, {
      method: 'POST',
    }),
  permanentlyDeleteAssessmentInstance: (projectId: string, instanceId: string) =>
    fetchApi<void>(`/api/v1/projects/${projectId}/assessments/${instanceId}/permanent`, {
      method: 'DELETE',
    }),
  updateProject: (id: string, data: { title?: string; icon?: string; workspace_id?: string }) =>
    fetchApi<Project>(`/api/v1/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  generateProjectOverview: (id: string) =>
    fetchApi<Project>(`/api/v1/projects/${id}/overview`, {
      method: 'POST',
    }),
  deleteProject: async (id: string) => {
    const url = `${API_URL}/api/v1/projects/${id}`;
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
  permanentlyDeleteProject: async (id: string) => {
    const url = `${API_URL}/api/v1/projects/${id}/permanent`;
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
  restoreProject: (id: string) =>
    fetchApi<Project>(`/api/v1/projects/${id}/restore`, {
      method: 'POST',
    }),
  confirmProject: (id: string) =>
    fetchApi<{ success: boolean; stage: string; message: string }>(
      `/api/v1/projects/${id}/confirm`,
      { method: 'POST' }
    ),
  getMemo: (projectId: string) =>
    fetchApi<MemoResponse>(`/api/v1/projects/${projectId}/memo`),

  // Export
  exportMemo: (projectId: string, memoVersionId?: string) =>
    fetchApi<{ success: boolean; export_id: string; download_url: string; filename: string }>(
      `/api/v1/projects/${projectId}/export`,
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
  getTools: () =>
    fetchApi<AssessmentDefinition[]>('/api/v1/tools'),
  getRecommendedTools: (projectId: string) =>
    fetchApi<{
      recommendations: { tool: AssessmentDefinition; confidence: number; recommended: boolean }[];
      project_type: string | null;
    }>(`/api/v1/projects/${projectId}/recommended-tools`),
  selectTools: (projectId: string, toolIds: string[]) =>
    fetchApi<{ success: boolean; selected_tools: string[]; stage: string }>(
      `/api/v1/projects/${projectId}/select-tools`,
      {
        method: 'POST',
        body: JSON.stringify({ tool_ids: toolIds }),
      }
    ),
  updateToolInputs: (projectId: string, inputs: Record<string, any>) =>
    fetchApi<{ success: boolean; inputs: Record<string, any>; missing_inputs: Record<string, string[]>; ready_to_generate: boolean }>(
      `/api/v1/projects/${projectId}/update-inputs`,
      {
        method: 'POST',
        body: JSON.stringify(inputs),
      }
    ),

  // ── Assessment Workflow ──────────────────────────────────────────
  getProjectPlan: (projectId: string) =>
    fetchApi<{ project_plan: ProjectPlan | null }>(
      `/api/v1/projects/${projectId}/project-plan`
    ),
  getProjectHealth: (projectId: string) =>
    fetchApi<ProjectHealthResponse>(`/api/v1/projects/${projectId}/project-health`),
  refreshProjectHealth: (projectId: string, source: string = 'manual_refresh') =>
    fetchApi<ProjectHealthResponse>(`/api/v1/projects/${projectId}/project-health/refresh`, {
      method: 'POST',
      body: JSON.stringify({ source }),
    }),
  overrideProjectHealthDimension: (
    projectId: string,
    dimensionId: string,
    status: ProjectHealthStatus,
    explanation?: string,
  ) =>
    fetchApi<ProjectHealthResponse>(
      `/api/v1/projects/${projectId}/project-health/${dimensionId}/override`,
      {
        method: 'POST',
        body: JSON.stringify({ status, explanation: explanation || null }),
      },
    ),
  generateProjectPlan: (projectId: string) =>
    fetchApi<{ project_plan: ProjectPlan }>(
      `/api/v1/projects/${projectId}/project-plan`,
      { method: 'POST' }
    ),
  updatePlanItemStatus: (
    projectId: string,
    itemId: string,
    status: 'not_started' | 'in_progress' | 'complete',
  ) =>
    fetchApi<{ success: boolean; item_id: string; status: string }>(
      `/api/v1/projects/${projectId}/project-plan/items/${itemId}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }
    ),
  addPlanItem: (projectId: string, pillarId: string, title: string, itemType: 'deliverable' | 'assessment' = 'deliverable', phaseId?: string) =>
    fetchApi<{ success: boolean; item: ProjectPlanItem }>(
      `/api/v1/projects/${projectId}/project-plan/pillars/${pillarId}/items`,
      {
        method: 'POST',
        body: JSON.stringify({ title, item_type: itemType, ...(phaseId ? { phase_id: phaseId } : {}) }),
      }
    ),
  deletePlanItem: (projectId: string, itemId: string) =>
    fetchApi<{ success: boolean; item_id: string }>(
      `/api/v1/projects/${projectId}/project-plan/items/${itemId}`,
      { method: 'DELETE' }
    ),
  deletePlanElement: (projectId: string, itemId: string, elementIndex: number) =>
    fetchApi<{ success: boolean; item_id: string; element_index: number }>(
      `/api/v1/projects/${projectId}/project-plan/items/${itemId}/elements/${elementIndex}`,
      { method: 'DELETE' }
    ),

  // Project plan deep dive
  deepDiveItem: (
    projectId: string,
    itemId: string,
    body: {
      item_title: string;
      item_classification: string;
      item_rationale: string;
      pillar_name: string;
      assessment_type?: string | null;
    }
  ) =>
    fetchApiWithTimeout<DeepDiveResult>(
      `/api/v1/projects/${projectId}/project-plan/items/${itemId}/deep-dive`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      30000,
    ),

  // Chat sessions — optionally scoped to a single project
};
