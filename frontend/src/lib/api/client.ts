import { isStoredFeatureFlagEnabled } from '@/lib/featureFlags';
import { isDemoActive } from '@/lib/demo/demoSession';
import { tryResolveDemoRequest } from '@/lib/demo/demoApi';

const CONFIGURED_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/**
 * Resolve API base for a browser hostname.
 *
 * On LAN/phone hosts (anything other than localhost), return '' so requests
 * stay same-origin and Next.js rewrites proxy to the Mac backend. A baked-in
 * `http://localhost:8000` would hit the phone itself and fail with Safari's
 * "Load failed" after login.
 */
export function resolveApiUrlForHost(
  hostname: string | null | undefined,
  configured: string = CONFIGURED_API_URL,
): string {
  if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
    return '';
  }
  return configured;
}

/** Browser API base URL — see `resolveApiUrlForHost`. */
export function getApiUrl(): string {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : undefined;
  return resolveApiUrlForHost(hostname);
}

/** Static configured URL (SSR / tooling). Prefer `getApiUrl()` for browser fetches. */
export const API_URL = CONFIGURED_API_URL;

/** Thrown by fetchApi with the HTTP status attached so callers can tell a
 * permanent "not found / no access" (404/403) from a transient failure
 * (network error, 5xx) instead of treating both as "keep retrying forever". */
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Get the current user's ID token for API requests.
// Uses authStateReady() so calls made immediately after a page load/redirect
// (e.g. the OAuth callback redirect) still get a token once Firebase has
// restored the session — without blocking after auth state is already known.
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
  if (isDemoActive()) {
    // Always short-circuit in demo — never hit the real API without a token.
    return tryResolveDemoRequest<T>(endpoint, options) as T;
  }

  const url = `${getApiUrl()}${endpoint}`;

  const token = await getAuthToken();
  const useBillingTestHeaders = isStoredFeatureFlagEnabled('billing_test_headers');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
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
    const message = error.detail?.message || error.detail || `HTTP ${response.status}`;
    throw new ApiError(message, response.status);
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

export function workflowVersionHeaders(workflowVersion?: number): Record<string, string> | undefined {
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

/** Parse a download filename from a Content-Disposition header. */
export function parseContentDispositionFilename(
  disposition: string | null | undefined,
  fallback: string,
): string {
  if (!disposition) return fallback;

  const starMatch = disposition.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;\n]+)/i);
  if (starMatch?.[1]) {
    try {
      const decoded = decodeURIComponent(starMatch[1].trim().replace(/^["']|["']$/g, ''));
      if (decoded) return decoded;
    } catch {
      // fall through to plain filename=
    }
  }

  // Match filename= but not filename*=
  const plainMatch = disposition.match(/(?:^|;\s*)filename\s*=\s*(?:"([^"]+)"|([^;\n]+))/i);
  if (plainMatch) {
    const value = (plainMatch[1] || plainMatch[2] || '').trim();
    if (value) return value;
  }

  return fallback;
}
