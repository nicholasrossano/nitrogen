import { isStoredFeatureFlagEnabled } from '@/lib/featureFlags';

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function getAuthToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  try {
    const { getAuth } = await import('firebase/auth');
    const { app } = await import('@/lib/firebase');
    const auth = getAuth(app);
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
}

export async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  const token = await getAuthToken();
  const useBillingTestHeaders = isStoredFeatureFlagEnabled('billing_test_headers');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (useBillingTestHeaders) {
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

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

export async function fetchApiWithTimeout<T>(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs: number = 30000,
): Promise<T> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchApi<T>(endpoint, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export function workflowVersionHeaders(
  workflowVersion?: number,
): Record<string, string> | undefined {
  if (workflowVersion === undefined || workflowVersion === null) return undefined;
  return { 'X-Workflow-Version': String(workflowVersion) };
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
