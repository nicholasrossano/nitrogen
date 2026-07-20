/** Client-only demo session — sessionStorage flag, no backend/auth. */

export const DEMO_PROJECT_ID = 'demo-rift-valley-solar';
export const DEMO_WORKSPACE_ID = 'demo-workspace';

const DEMO_ACTIVE_KEY = 'nitrogen-demo-active';
const LEAVING_DEMO_FOR_AUTH_KEY = 'nitrogen-leaving-demo-for-auth';
export const DEMO_SESSION_EVENT = 'nitrogen:demo-session-change';

/** Same-tab fallback when sessionStorage is unavailable or briefly out of sync. */
let memoryDemoActive = false;
/** Blocks leaveDemo while /demo (or View Demo) is still bootstrapping. */
let demoEntryInProgress = false;
/** Suppresses /demo re-bootstrap while navigating to login/signup. */
let leavingDemoForAuth = false;

function emitDemoSessionChange() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(DEMO_SESSION_EVENT));
}

export function isDemoActive(): boolean {
  if (typeof window === 'undefined') return false;
  if (memoryDemoActive || demoEntryInProgress) return true;
  try {
    return sessionStorage.getItem(DEMO_ACTIVE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isDemoEntryInProgress(): boolean {
  return demoEntryInProgress;
}

export function isLeavingDemoForAuth(): boolean {
  if (leavingDemoForAuth) return true;
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(LEAVING_DEMO_FOR_AUTH_KEY) === '1';
  } catch {
    return false;
  }
}

/** Call before clearing demo when heading to /login so orphaned-path guards stay quiet. */
export function beginLeavingDemoForAuth(): void {
  leavingDemoForAuth = true;
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(LEAVING_DEMO_FOR_AUTH_KEY, '1');
  } catch {
    // Memory flag is enough for this tab's React effects.
  }
}

export function clearLeavingDemoForAuth(): void {
  leavingDemoForAuth = false;
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(LEAVING_DEMO_FOR_AUTH_KEY);
  } catch {
    // ignore
  }
}

export function beginDemoEntry(): void {
  demoEntryInProgress = true;
  clearLeavingDemoForAuth();
}

export function endDemoEntry(): void {
  demoEntryInProgress = false;
}

export function enterDemo(): void {
  if (typeof window === 'undefined') return;
  memoryDemoActive = true;
  clearLeavingDemoForAuth();
  try {
    sessionStorage.setItem(DEMO_ACTIVE_KEY, '1');
  } catch {
    // Memory flag still keeps this tab in demo when storage is blocked.
  }
  emitDemoSessionChange();
}

export function exitDemo(): void {
  if (typeof window === 'undefined') return;
  memoryDemoActive = false;
  demoEntryInProgress = false;
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

/** True when this path is the fixture project (with or without an active demo session). */
export function isDemoProjectPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return (
    pathname === `/projects/${DEMO_PROJECT_ID}` ||
    pathname.startsWith(`/projects/${DEMO_PROJECT_ID}/`) ||
    pathname.startsWith(`/projects/${DEMO_PROJECT_ID}?`)
  );
}
