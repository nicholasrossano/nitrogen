/**
 * Hard boundary between demo and real sessions.
 * Demo is sessionStorage-only; real prefs live in localStorage. Crossing either
 * direction must clear in-memory stores so the two never render mixed data.
 */

import { clearLastProjectPreference } from '@/lib/authReturnUrl';
import { resetClientStores } from '@/lib/sessionBoundary';
import { track } from '@vercel/analytics';
import {
  beginDemoEntry,
  beginLeavingDemoForAuth,
  endDemoEntry,
  enterDemo,
  exitDemo,
  isDemoActive,
  isDemoEntryInProgress,
} from '@/lib/demo/demoSession';

export function resetClientStateForDemoBoundary(): void {
  resetClientStores();
  // Crossing demo↔real must not keep a last-project resume (demo id or a
  // real UUID that would 404 after the next login).
  clearLastProjectPreference();
}

/**
 * Enter demo with a clean break from any real session.
 * Callers that may have a Firebase user must pass signOut.
 *
 * Sets the demo flag before awaiting sign-out so a slow/racy auth callback
 * cannot bounce /projects/demo-* to /login during bootstrap.
 */
export async function startDemoSession(options?: {
  signOut?: () => Promise<void>;
  hasUser?: boolean;
}): Promise<void> {
  beginDemoEntry();
  try {
    // Flag first — ProtectedRoute and the demo project page must see demo
    // as active even while Firebase sign-out is still in flight.
    resetClientStateForDemoBoundary();
    enterDemo();
    track('demo_open');

    if (options?.hasUser && options.signOut) {
      try {
        await options.signOut();
      } catch {
        // Still proceed — entry lock + enterDemo keep fixtures from mixing
        // until a later real auth event (outside entry) clears demo.
      }
      // Re-affirm after sign-out in case a transient auth callback cleared storage.
      enterDemo();
    }
  } finally {
    endDemoEntry();
  }
}

/** Leave demo before login/signup or when a real Firebase session appears. */
export function leaveDemoSession(): void {
  // Never abort an in-flight /demo bootstrap — auth may still emit the
  // pre-sign-out user once before null.
  if (isDemoEntryInProgress()) return;

  if (!isDemoActive()) {
    resetClientStateForDemoBoundary();
    return;
  }
  exitDemo();
  resetClientStateForDemoBoundary();
}

/**
 * Leave demo and open signup.
 *
 * Clearing the demo flag while still on `/projects/demo-*` races ProtectedRoute
 * / the project page, which otherwise re-bootstrap via `/demo`. Mark leaving
 * first, then hard-navigate so soft client routing cannot win that race.
 */
export function leaveDemoForSignup(
  navigate: (url: string) => void = (url) => {
    window.location.assign(url);
  },
): void {
  beginLeavingDemoForAuth();
  leaveDemoSession();
  navigate('/login?mode=signup');
}
