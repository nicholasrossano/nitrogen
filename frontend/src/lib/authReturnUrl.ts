/**
 * Post-login resume URL helpers.
 *
 * Project deep-links in `?returnUrl=` are a common source of Workspace / Project
 * not found after auth (demo→login, stale bookmarks, another account's id).
 * Prefer landing on /chat and letting the user open a project they can access.
 */

import { DEMO_PROJECT_ID } from '@/lib/demo/demoSession';

const LAST_PROJECT_KEY = 'nitrogen-last-project-id';

/** True for /projects and /projects/:id (with optional query/hash). */
export function isProjectResumePath(path: string): boolean {
  return path === '/projects' || path.startsWith('/projects/') || path.startsWith('/projects?');
}

/**
 * Sanitize login `returnUrl`. Relative same-origin paths only; never resume a
 * project route from the login query string.
 */
export function getSafeReturnUrl(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  if (raw === `/projects/${DEMO_PROJECT_ID}` || raw.startsWith(`/projects/${DEMO_PROJECT_ID}?`)) {
    return '/';
  }
  if (isProjectResumePath(raw)) return '/';
  return raw;
}

export function clearLastProjectPreference(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(LAST_PROJECT_KEY);
  } catch {
    // ignore
  }
}

/** Resolve post-auth navigation target and drop a stale last-project resume. */
export function resolvePostAuthDestination(rawReturnUrl: string | null): string {
  const discardedProject = Boolean(rawReturnUrl && isProjectResumePath(rawReturnUrl));
  const safe = getSafeReturnUrl(rawReturnUrl);
  if (discardedProject || safe === '/') {
    clearLastProjectPreference();
  }
  return safe === '/' ? '/chat' : safe;
}
