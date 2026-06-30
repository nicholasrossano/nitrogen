export * from './types';
export {
  API_URL,
  fetchApi,
  fetchApiWithTimeout,
  getAuthToken,
  triggerBlobDownload,
  workflowVersionHeaders,
} from './client';
import { triggerBlobDownload } from './client';
import { projectsApi } from './projects';
import { workspacesApi } from './workspaces';
import { evidenceApi } from './evidence';
import { chatApi } from './chat';
import { assessmentsApi } from './assessments';
import { sharingApi } from './sharing';
import { billingApi } from './billing';

export const api = {
  ...projectsApi,
  ...workspacesApi,
  ...evidenceApi,
  ...chatApi,
  ...assessmentsApi,
  ...sharingApi,
  ...billingApi,
  triggerBlobDownload,
};
