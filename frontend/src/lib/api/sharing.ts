import {
  API_URL,
  fetchApi,
  fetchApiWithTimeout,
  getAuthToken,
  triggerBlobDownload,
  workflowVersionHeaders,
} from './client';
import type {
  ProjectShare,
  UserSearchResult,
} from './types';



export const sharingApi = {
  searchUsers: (q: string): Promise<UserSearchResult[]> =>
    fetchApi<UserSearchResult[]>(`/api/v1/users/search?q=${encodeURIComponent(q)}`),
  getShares: (projectId: string): Promise<ProjectShare[]> =>
    fetchApi<ProjectShare[]>(`/api/v1/projects/${projectId}/shares`),
  createShare: (projectId: string, email: string, role: 'editor' | 'viewer'): Promise<ProjectShare> =>
    fetchApi<ProjectShare>(`/api/v1/projects/${projectId}/shares`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),
  updateShare: (projectId: string, shareId: string, role: 'editor' | 'viewer'): Promise<ProjectShare> =>
    fetchApi<ProjectShare>(`/api/v1/projects/${projectId}/shares/${shareId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  deleteShare: (projectId: string, shareId: string): Promise<void> =>
    fetchApi<void>(`/api/v1/projects/${projectId}/shares/${shareId}`, {
      method: 'DELETE',
    }),

  // ── Google Drive ────────────────────────────────────────────────────────────,
};
