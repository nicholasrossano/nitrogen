import {
  API_URL,
  fetchApi,
  getAuthToken,
} from './client';
import type {
  Project,
  AssessmentInstance,
  AssessmentDefinition,
  ProjectHealthResponse,
  ProjectStatusResponse,
  ProjectStatusCategoryConfig,
  ProjectStatusCriteria,
  ProjectPlanItem,
  ProjectPlan,
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
  updateAssessmentInstance: (projectId: string, instanceId: string, data: { title?: string | null }) =>
    fetchApi<AssessmentInstance>(`/api/v1/projects/${projectId}/assessments/${instanceId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
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
  confirmProject: (id: string) =>
    fetchApi<{ success: boolean; stage: string; message: string }>(
      `/api/v1/projects/${id}/confirm`,
      { method: 'POST' }
    ),

  // Export,
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

  // ── Assessment Workflow ──────────────────────────────────────────,
  getProjectPlan: (projectId: string) =>
    fetchApi<{ project_plan: ProjectPlan | null }>(
      `/api/v1/projects/${projectId}/project-plan`
    ),
  getProjectStatus: (projectId: string) =>
    fetchApi<ProjectStatusResponse>(`/api/v1/projects/${projectId}/project-status`),
  refreshProjectStatus: (projectId: string, source: string = 'manual_refresh') =>
    fetchApi<ProjectStatusResponse>(`/api/v1/projects/${projectId}/project-status/refresh`, {
      method: 'POST',
      body: JSON.stringify({ source }),
    }),
  listStatusCategories: (projectId: string) =>
    fetchApi<ProjectStatusCategoryConfig[]>(
      `/api/v1/projects/${projectId}/project-status/categories`,
    ),
  createStatusCategory: (
    projectId: string,
    body: { label: string; definition_text?: string; category_key?: string | null },
  ) =>
    fetchApi<ProjectStatusCategoryConfig>(
      `/api/v1/projects/${projectId}/project-status/categories`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  updateStatusCategory: (
    projectId: string,
    categoryKey: string,
    body: Partial<{
      label: string;
      definition_text: string;
      criteria: ProjectStatusCriteria | null;
      is_active: boolean;
    }>,
  ) =>
    fetchApi<ProjectStatusCategoryConfig>(
      `/api/v1/projects/${projectId}/project-status/categories/${categoryKey}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  deleteStatusCategory: (projectId: string, categoryKey: string) =>
    fetchApi<void>(`/api/v1/projects/${projectId}/project-status/categories/${categoryKey}`, {
      method: 'DELETE',
    }),
  generateStatusCategoryCriteria: (
    projectId: string,
    categoryKey: string,
    persist: boolean = true,
  ) =>
    fetchApi<ProjectStatusCriteria>(
      `/api/v1/projects/${projectId}/project-status/categories/${categoryKey}/criteria/generate`,
      { method: 'POST', body: JSON.stringify({ persist }) },
    ),
  /** @deprecated use getProjectStatus */
  getProjectHealth: (projectId: string) =>
    fetchApi<ProjectStatusResponse>(`/api/v1/projects/${projectId}/project-status`).then(
      (res): ProjectHealthResponse => ({
        domain: res.domain,
        project_id: res.project_id,
        stale: res.stale,
        dimensions: res.categories.map((row) => ({
          dimension_id: row.category_key,
          label: row.label,
          description: row.definition_text,
          status: row.status,
          effective_status: row.effective_status,
          confidence: row.confidence,
          rationale: row.rationale,
          critical_insight: row.critical_insight,
          supporting_evidence: row.supporting_evidence,
          suggested_improvement: row.suggested_improvement,
          retrieved_sources: row.retrieved_sources,
          positive_drivers: row.positive_drivers,
          negative_drivers: row.negative_drivers,
          blockers: row.blockers,
          missing_items: row.missing_items,
          relevant_modules: row.relevant_modules,
          relevant_module_names: row.relevant_module_names,
          relevant_assessments: row.relevant_assessments,
          improvement_actions: row.improvement_actions,
          uncertainties: row.uncertainties,
          update_source: row.update_source,
          last_updated_at: row.last_updated_at,
          is_stale: row.is_stale,
          has_override: row.has_override,
          overrides: row.overrides.map((o) => ({
            ...o,
            dimension_id: o.category_key,
          })),
        })),
      }),
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

  // Chat sessions — optionally scoped to a single project,
};
