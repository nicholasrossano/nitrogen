import {
  API_URL,
  fetchApi,
  fetchApiWithTimeout,
  getAuthToken,
  parseContentDispositionFilename,
  workflowVersionHeaders,
} from './client';
import type {
  BuildItem,
  StageState,
  StagedWorkflowState,
  StagedAssessmentWorkflowState,
  AssessmentAgentStatus,
  AssessmentActivityLog,
  AssessmentDecisionLogReport,
  AssumptionStatus,
  AssumptionSourceType,
  Assumption,
  AssumptionSummary,
  AssumptionCreateInput,
  AssumptionUpdateInput,
  AssumptionComment,
  DeepDiveResult,
} from './types';



export const assessmentsApi = {
  generateSetupDefaults: (instanceId: string) =>
    fetchApi<{ fields: Record<string, string> }>(
      `/api/v1/assessment-workflow/${instanceId}/setup/generate`,
      { method: 'POST' }
    ),
  confirmWorkflowSetup: (instanceId: string, fields: Record<string, any>) =>
    fetchApi<{ ok: boolean; current_stage: string }>(
      `/api/v1/assessment-workflow/${instanceId}/setup/confirm`,
      {
        method: 'POST',
        body: JSON.stringify({ fields }),
      }
    ),
  generateBuildLayer: (instanceId: string, layerId: string) =>
    fetchApi<{ items: BuildItem[]; layer_status: string }>(
      `/api/v1/assessment-workflow/${instanceId}/build/${layerId}/generate`,
      { method: 'POST' }
    ),
  deleteBuildItem: (instanceId: string, layerId: string, itemId: string) =>
    fetchApi<{ ok: boolean; remaining_count: number }>(
      `/api/v1/assessment-workflow/${instanceId}/build/${layerId}/items/${itemId}`,
      { method: 'DELETE' }
    ),
  reorderBuildItems: (instanceId: string, layerId: string, itemIds: string[]) =>
    fetchApi<{ ok: boolean }>(
      `/api/v1/assessment-workflow/${instanceId}/build/${layerId}/reorder`,
      {
        method: 'POST',
        body: JSON.stringify({ item_ids: itemIds }),
      }
    ),
  generateWorkflowOutput: (instanceId: string) =>
    fetchApi<{ output: Record<string, any>; status: string }>(
      `/api/v1/assessment-workflow/${instanceId}/output/generate`,
      { method: 'POST' }
    ),
  persistAssessmentWorkflowWidget: (instanceId: string, widgetData: Record<string, any>, workflowVersion?: number) =>
    fetchApi<{ instance_id: string; status: string; workflow_state: StagedWorkflowState; workflow_version: number }>(
      `/api/v1/assessment-workflow/${instanceId}/widget-state`,
      {
        method: 'POST',
        headers: workflowVersionHeaders(workflowVersion),
        body: JSON.stringify({ widget_data: widgetData }),
      }
    ),
  exportAssessmentOutputDocx: async (instanceId: string): Promise<{ blob: Blob; filename: string }> => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
      `${API_URL}/api/v1/assessment-workflow/${instanceId}/output/export`,
      { headers }
    );
    if (!res.ok) throw new Error('Export failed');
    const filename = parseContentDispositionFilename(
      res.headers.get('content-disposition'),
      'assessment.docx',
    );
    const blob = await res.blob();
    return { blob, filename };
  },

  // ── Staged workflow endpoints ──────────────────────────────────────,
  getStagedAssessmentWorkflowState: (instanceId: string) =>
    fetchApi<StagedAssessmentWorkflowState>(`/api/v1/assessment-workflow/${instanceId}/state`),
  getAssessmentAgentStatus: (instanceId: string) =>
    fetchApi<AssessmentAgentStatus>(`/api/v1/assessment-workflow/${instanceId}/agent-status`),
  getAssessmentActivityLog: (instanceId: string) =>
    fetchApi<AssessmentActivityLog>(`/api/v1/assessment-workflow/${instanceId}/activity-log`),
  runAssessment: (instanceId: string) =>
    fetchApi<AssessmentAgentStatus>(`/api/v1/assessment-workflow/${instanceId}/run`, {
      method: 'POST',
    }),
  populateStage: (instanceId: string, stageId: string, workflowVersion?: number) =>
    fetchApi<{ stage_id: string; stage_state: StageState; workflow_state: StagedWorkflowState; workflow_version: number }>(
      `/api/v1/assessment-workflow/${instanceId}/stages/${stageId}/populate`,
      { method: 'POST', headers: workflowVersionHeaders(workflowVersion) }
    ),
  confirmStage: (instanceId: string, stageId: string, workflowVersion?: number) =>
    fetchApi<{ stage_id: string; stage_state: StageState; workflow_state: StagedWorkflowState; workflow_version: number }>(
      `/api/v1/assessment-workflow/${instanceId}/stages/${stageId}/confirm`,
      { method: 'POST', headers: workflowVersionHeaders(workflowVersion) }
    ),
  addStageItem: (instanceId: string, stageId: string, content: Record<string, any>, workflowVersion?: number) =>
    fetchApi<{ item: BuildItem; workflow_version: number }>(
      `/api/v1/assessment-workflow/${instanceId}/stages/${stageId}/items`,
      { method: 'POST', headers: workflowVersionHeaders(workflowVersion), body: JSON.stringify({ content }) }
    ),
  editStageItem: (instanceId: string, stageId: string, itemId: string, content: Record<string, any>, workflowVersion?: number) =>
    fetchApi<{ item: BuildItem; workflow_version: number }>(
      `/api/v1/assessment-workflow/${instanceId}/stages/${stageId}/items/${itemId}`,
      { method: 'PATCH', headers: workflowVersionHeaders(workflowVersion), body: JSON.stringify({ content }) }
    ),
  deleteStageItem: (instanceId: string, stageId: string, itemId: string, workflowVersion?: number) =>
    fetchApi<{ ok: boolean; remaining_count: number; workflow_version: number }>(
      `/api/v1/assessment-workflow/${instanceId}/stages/${stageId}/items/${itemId}`,
      { method: 'DELETE', headers: workflowVersionHeaders(workflowVersion) }
    ),
  reorderStageItems: (instanceId: string, stageId: string, itemIds: string[], workflowVersion?: number) =>
    fetchApi<{ ok: boolean; workflow_version: number }>(
      `/api/v1/assessment-workflow/${instanceId}/stages/${stageId}/reorder`,
      { method: 'POST', headers: workflowVersionHeaders(workflowVersion), body: JSON.stringify({ item_ids: itemIds }) }
    ),
  enrichRecord: (instanceId: string, stageId: string, itemId: string, workflowVersion?: number) =>
    fetchApi<{ item_id: string; record: Record<string, any>; workflow_version: number }>(
      `/api/v1/assessment-workflow/${instanceId}/stages/${stageId}/records/${itemId}/enrich`,
      { method: 'POST', headers: workflowVersionHeaders(workflowVersion) }
    ),
  enrichStakeholderFromMap: (instanceId: string, itemId: string, workflowVersion?: number) =>
    fetchApi<{ item_id: string; record: Record<string, any>; workflow_version: number }>(
      `/api/v1/assessment-workflow/${instanceId}/stakeholders/${itemId}/enrich`,
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
      assessment_type?: string | null;
    },
    workflowVersion?: number,
  ) =>
    fetchApiWithTimeout<DeepDiveResult>(
      `/api/v1/assessment-workflow/${instanceId}/implementation/${itemId}/deep-dive`,
      { method: 'POST', headers: workflowVersionHeaders(workflowVersion), body: JSON.stringify(body) },
      30000,
    ),
  deepDiveAssessmentMapItem: (
    instanceId: string,
    itemId: string,
    body: {
      item_title: string;
      item_classification: string;
      item_rationale: string;
      pillar_name: string;
      assessment_type?: string | null;
    },
    workflowVersion?: number,
  ) =>
    fetchApiWithTimeout<DeepDiveResult>(
      `/api/v1/assessment-workflow/${instanceId}/map/${itemId}/deep-dive`,
      { method: 'POST', headers: workflowVersionHeaders(workflowVersion), body: JSON.stringify(body) },
      30000,
    ),
  updateRecord: (instanceId: string, stageId: string, itemId: string, fields: Record<string, any>, workflowVersion?: number) =>
    fetchApi<{ item_id: string; record: Record<string, any>; workflow_version: number }>(
      `/api/v1/assessment-workflow/${instanceId}/stages/${stageId}/records/${itemId}`,
      { method: 'PATCH', headers: workflowVersionHeaders(workflowVersion), body: JSON.stringify({ fields }) }
    ),
  approveFinalAssessmentOutput: (instanceId: string, workflowVersion?: number) =>
    fetchApi<{ workflow_state: StagedWorkflowState; workflow_version: number }>(
      `/api/v1/assessment-workflow/${instanceId}/final-approval`,
      { method: 'POST', headers: workflowVersionHeaders(workflowVersion) }
    ),
  revokeFinalAssessmentApproval: (instanceId: string, workflowVersion?: number) =>
    fetchApi<{ workflow_state: StagedWorkflowState; workflow_version: number }>(
      `/api/v1/assessment-workflow/${instanceId}/final-approval`,
      { method: 'DELETE', headers: workflowVersionHeaders(workflowVersion) }
    ),
  exportStagedAssessment: async (instanceId: string): Promise<{ blob: Blob; filename: string }> => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
      `${API_URL}/api/v1/assessment-workflow/${instanceId}/export`,
      { headers }
    );
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      const message =
        typeof detail?.detail === 'string'
          ? detail.detail
          : res.status === 409
            ? 'Export already in progress'
            : 'Export failed';
      throw new Error(message);
    }
    const filename = parseContentDispositionFilename(
      res.headers.get('content-disposition'),
      'export.docx',
    );
    const blob = await res.blob();
    return { blob, filename };
  },
  getAssessmentDecisionLog: (instanceId: string) => {
    return fetchApi<AssessmentDecisionLogReport>(`/api/v1/assessment-workflow/${instanceId}/decision-log`);
  },
  getAssumptionsSummary: (projectId: string) =>
    fetchApi<AssumptionSummary>(`/api/v1/projects/${projectId}/assumptions/summary`),
  listAssumptions: (
    projectId: string,
    filters?: { status?: AssumptionStatus | ''; source_type?: AssumptionSourceType | ''; assessment?: string },
  ) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.source_type) params.set('source_type', filters.source_type);
    if (filters?.assessment) params.set('assessment', filters.assessment);
    const query = params.toString();
    return fetchApi<Assumption[]>(
      `/api/v1/projects/${projectId}/assumptions${query ? `?${query}` : ''}`,
    );
  },
  resolveAssumption: (
    projectId: string,
    assessmentId: string,
    fieldName: string,
    assessmentInstanceId?: string | null,
  ) => {
    const params = new URLSearchParams({
      assessment_id: assessmentId,
      field_name: fieldName,
    });
    if (assessmentInstanceId) params.set('assessment_instance_id', assessmentInstanceId);
    return fetchApi<{ found: boolean; assumption: Assumption | null }>(
      `/api/v1/projects/${projectId}/assumptions/resolve?${params.toString()}`,
    );
  },
  createAssumption: (projectId: string, data: AssumptionCreateInput) =>
    fetchApi<Assumption>(`/api/v1/projects/${projectId}/assumptions`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getAssumption: (assumptionId: string) =>
    fetchApi<Assumption>(`/api/v1/assumptions/${assumptionId}`),
  updateAssumption: (assumptionId: string, data: AssumptionUpdateInput) =>
    fetchApi<Assumption>(`/api/v1/assumptions/${assumptionId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteAssumption: (assumptionId: string) =>
    fetchApi<void>(`/api/v1/assumptions/${assumptionId}`, {
      method: 'DELETE',
    }),
  listAssumptionComments: (assumptionId: string) =>
    fetchApi<AssumptionComment[]>(`/api/v1/assumptions/${assumptionId}/comments`),
  createAssumptionComment: (assumptionId: string, body: string) =>
    fetchApi<AssumptionComment>(`/api/v1/assumptions/${assumptionId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  exportAssessmentDecisionLogXlsx: async (instanceId: string): Promise<{ blob: Blob; filename: string }> => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(
      `${API_URL}/api/v1/assessment-workflow/${instanceId}/decision-log/export.xlsx`,
      { headers }
    );
    if (!res.ok) throw new Error('Decision log export failed');
    const filename = parseContentDispositionFilename(
      res.headers.get('content-disposition'),
      'decision-log.xlsx',
    );
    const blob = await res.blob();
    return { blob, filename };
  },

  // Project Plan,
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

  // Carbon endpoints,
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

  // Solar estimate (PVWatts) endpoints,
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

  // ── Sharing ──────────────────────────────────────────────────────,
};
