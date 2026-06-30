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
  EvidenceChunkDetail,
  EvidenceDoc,
  ProjectMaterial,
  ProjectFilesResponse,
  DriveLinkedFile,
  DriveImportResult,
  DriveSyncResult,
} from './types';



export const evidenceApi = {
  uploadEvidence: async (projectId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(
        `${API_URL}/api/v1/projects/${projectId}/evidence`,
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
  pasteEvidence: (projectId: string, content: string, title?: string) =>
    fetchApi<{ success: boolean; document: EvidenceDoc; stage: string }>(
      `/api/v1/projects/${projectId}/evidence/text`,
      {
        method: 'POST',
        body: JSON.stringify({ content, title }),
      }
    ),
  getEvidence: (projectId: string) =>
    fetchApi<EvidenceDoc[]>(`/api/v1/projects/${projectId}/evidence`),
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

  // --- Project Materials ---,
  getMaterials: (projectId: string) =>
    fetchApi<ProjectMaterial[]>(`/api/v1/projects/${projectId}/materials`),
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
  getProjectFiles: (projectId: string) =>
    fetchApi<ProjectFilesResponse>(`/api/v1/projects/${projectId}/files`),
  downloadDeliverable: async (projectId: string, toolId: string, filename: string) => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(
      `${API_URL}/api/v1/projects/${projectId}/deliverables/${toolId}/export`,
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
  deleteGeneratedFile: async (projectId: string, toolId: string) => {
    const token = await getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(
      `${API_URL}/api/v1/projects/${projectId}/deliverables/${toolId}`,
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
  getMaterialFileBytes: async (materialId: string): Promise<ArrayBuffer> => {
    const token = await getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${API_URL}/api/v1/materials/${materialId}/download`, {
      headers,
    });
    if (!response.ok) {
      throw new Error('Failed to fetch project material file');
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
  exportChecklist: async (projectId: string, content: any) => {
    const token = await getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(
      `${API_URL}/api/v1/projects/${projectId}/export-checklist`,
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

  // Tools,
  getGoogleAuthUrl: (projectId: string) =>
    fetchApi<{ auth_url: string }>(
      '/api/v1/google/connect',
      { method: 'POST', body: JSON.stringify({ project_id: projectId }) }
    ),
  getGoogleDriveStatus: () =>
    fetchApi<{ connected: boolean; email: string | null }>('/api/v1/google/status'),
  getGoogleDriveAccessToken: () =>
    fetchApi<{ access_token: string }>('/api/v1/google/access-token'),
  disconnectGoogleDrive: () =>
    fetchApi<{ success: boolean }>('/api/v1/google/disconnect', { method: 'DELETE' }),
  importFromDrive: (projectId: string, fileIds: string[]) =>
    fetchApi<DriveImportResult>(
      `/api/v1/projects/${projectId}/drive/import`,
      { method: 'POST', body: JSON.stringify({ file_ids: fileIds }) }
    ),
  getDriveLinkedFiles: (projectId: string) =>
    fetchApi<DriveLinkedFile[]>(`/api/v1/projects/${projectId}/drive/linked`),
  syncDriveFiles: (projectId: string) =>
    fetchApi<DriveSyncResult>(
      `/api/v1/projects/${projectId}/drive/sync`,
      { method: 'POST' }
    ),
  unlinkDriveFile: (projectId: string, linkedId: string) =>
    fetchApi<{ success: boolean }>(
      `/api/v1/projects/${projectId}/drive/linked/${linkedId}`,
      { method: 'DELETE' }
    ),

  // ── Billing ──────────────────────────────────────────────────────,
};
