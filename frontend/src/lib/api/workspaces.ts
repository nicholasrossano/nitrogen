import {
  API_URL,
  fetchApi,
  fetchApiWithTimeout,
  getAuthToken,
  triggerBlobDownload,
  workflowVersionHeaders,
} from './client';
import type {
  WorkspaceMember,
  Workspace,
  WorkspaceDetail,
  WorkspaceKnowledgeBank,
  EvidenceDoc,
  DriveImportResult,
} from './types';



export const workspacesApi = {
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
  listWorkspaceKnowledgeBanks: (workspaceId: string) =>
    fetchApi<WorkspaceKnowledgeBank[]>(`/api/v1/workspaces/${workspaceId}/knowledge-banks`),
  createWorkspaceKnowledgeBank: (workspaceId: string, data: { name: string; base_url: string; index_now?: boolean }) =>
    fetchApi<WorkspaceKnowledgeBank>(
      `/api/v1/workspaces/${workspaceId}/knowledge-banks?index_now=${data.index_now !== false}`,
      {
        method: 'POST',
        body: JSON.stringify({ name: data.name, base_url: data.base_url }),
      },
    ),
  updateWorkspaceKnowledgeBank: (
    workspaceId: string,
    bankId: string,
    data: { name?: string; base_url?: string; is_active?: boolean },
  ) =>
    fetchApi<WorkspaceKnowledgeBank>(
      `/api/v1/workspaces/${workspaceId}/knowledge-banks/${bankId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      },
    ),
  reindexWorkspaceKnowledgeBank: (workspaceId: string, bankId: string) =>
    fetchApi<WorkspaceKnowledgeBank>(
      `/api/v1/workspaces/${workspaceId}/knowledge-banks/${bankId}/reindex`,
      { method: 'POST' },
    ),
  deleteWorkspaceKnowledgeBank: (workspaceId: string, bankId: string) =>
    fetchApi<void>(`/api/v1/workspaces/${workspaceId}/knowledge-banks/${bankId}`, {
      method: 'DELETE',
    }),
  deleteWorkspace: (workspaceId: string) =>
    fetchApi<void>(`/api/v1/workspaces/${workspaceId}`, {
      method: 'DELETE',
    }),
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
  getWorkspaceEvidence: (workspaceId: string) =>
    fetchApi<EvidenceDoc[]>(`/api/v1/workspaces/${workspaceId}/evidence`),
  importWorkspaceFromDrive: (workspaceId: string, fileIds: string[]) =>
    fetchApi<DriveImportResult>(
      `/api/v1/workspaces/${workspaceId}/drive/import`,
      { method: 'POST', body: JSON.stringify({ file_ids: fileIds }) }
    ),
};
