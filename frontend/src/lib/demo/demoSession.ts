/** Client-only demo session — sessionStorage flag, no backend/auth. */

export const DEMO_PROJECT_ID = 'demo-rift-valley-solar';
export const DEMO_WORKSPACE_ID = 'demo-workspace';

const DEMO_ACTIVE_KEY = 'nitrogen-demo-active';
export const DEMO_SESSION_EVENT = 'nitrogen:demo-session-change';

function emitDemoSessionChange() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(DEMO_SESSION_EVENT));
}

export function isDemoActive(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(DEMO_ACTIVE_KEY) === '1';
  } catch {
    return false;
  }
}

export function enterDemo(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(DEMO_ACTIVE_KEY, '1');
  } catch {
    // Non-fatal; demo may still fail closed on next read.
  }
  emitDemoSessionChange();
}

export function exitDemo(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(DEMO_ACTIVE_KEY);
  } catch {
    // ignore
  }
  emitDemoSessionChange();
}

export function buildDemoProjectPath(options?: { chat?: string | null; panel?: string | null }): string {
  const params = new URLSearchParams();
  if (options?.chat) params.set('chat', options.chat);
  if (options?.panel) params.set('panel', options.panel);
  const qs = params.toString();
  return qs ? `/projects/${DEMO_PROJECT_ID}?${qs}` : `/projects/${DEMO_PROJECT_ID}`;
}
