/**
 * Auth / account session boundary.
 *
 * Workspace and last-project prefs are browser-local and not scoped by Firebase
 * UID. Crossing accounts in the same browser must clear them so a new user does
 * not inherit another account's IDs (404 Workspace / Project not found).
 *
 * Tour completion is scoped per Firebase UID in `tourStore.byUid` and restored
 * on bind — logout / account switch must not wipe another account's progress.
 */

import { useProjectStore } from '@/stores/projectStore';
import { invalidateWorkspaceLoads, useWorkspaceStore } from '@/stores/workspaceStore';
import { useBillingStore } from '@/stores/billingStore';
import { useTourStore } from '@/stores/tourStore';
import { clearSwrCache } from '@/lib/swrCache';
import {
  DEMO_PROJECT_ID,
  isDemoActive,
  isDemoEntryInProgress,
} from '@/lib/demo/demoSession';

const ACTIVE_WORKSPACE_KEY = 'nitrogen-active-workspace-id';
const LAST_TOUCHED_WORKSPACE_KEY = 'nitrogen-last-touched-workspace-id';
const LAST_PROJECT_KEY = 'nitrogen-last-project-id';
const AUTH_UID_KEY = 'nitrogen-auth-uid';

/** Drop in-memory client state shared by demo and auth boundaries. */
export function resetClientStores(): void {
  invalidateWorkspaceLoads();
  clearSwrCache();
  useProjectStore.getState().reset();
  useProjectStore.setState({ projectsById: {}, projectAccessErrors: {} });
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspace: null,
    activeWorkspaceDetail: null,
    loading: false,
    error: null,
  });
  useBillingStore.setState({
    tier: null,
    status: '',
    usedUsd: 0,
    limitUsd: 0,
    usagePercent: 0,
    trialMessagesRemaining: null,
    accessCodeRedeemed: false,
    accessCodeAvailable: false,
    showPaywall: false,
    paywallContext: null,
    loading: false,
    loaded: false,
  });
}

function clearRoutingPreferences(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(LAST_PROJECT_KEY);
    localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
    localStorage.removeItem(LAST_TOUCHED_WORKSPACE_KEY);
  } catch {
    // ignore
  }
}

function readStoredAuthUid(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(AUTH_UID_KEY);
  } catch {
    return null;
  }
}

function writeStoredAuthUid(uid: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (uid) localStorage.setItem(AUTH_UID_KEY, uid);
    else localStorage.removeItem(AUTH_UID_KEY);
  } catch {
    // ignore
  }
}

/**
 * Call on every Firebase auth emission.
 * - Same UID: re-bind tour if sign-out cleared the active surface.
 * - First stamp (prevUid null): record uid + scrub orphan routing keys only.
 *   Do NOT wipe in-memory project stores — that blanked Overview / Home title
 *   on live projects that had already loaded for the signed-in user.
 * - UID change: clear stores + routing prefs; bind that account's tour prefs.
 * - Sign-out (null): clear in-memory stores + unbind tour; keep stored UID and
 *   per-account tour map so the same user can sign back in without re-touring.
 */
export function syncAuthSessionBoundary(nextUid: string | null): void {
  if (typeof window === 'undefined') return;

  const prevUid = readStoredAuthUid();

  if (nextUid === null) {
    // Demo runs signed-out. Firebase sign-out (or a late null emission after
    // /demo bootstrap) must not wipe fixture state already painted on Home.
    if (!isDemoActive() && !isDemoEntryInProgress()) {
      resetClientStores();
    }
    // Drop a demo id if it leaked into persistent prefs.
    try {
      if (localStorage.getItem(LAST_PROJECT_KEY) === DEMO_PROJECT_ID) {
        localStorage.removeItem(LAST_PROJECT_KEY);
      }
    } catch {
      // ignore
    }
    // Unbind active tour surface; byUid buckets stay so re-login restores them.
    useTourStore.getState().bindAccount(null);
    return;
  }

  if (prevUid === nextUid) {
    // Re-login after sign-out left activeUid null — restore this account's tour.
    if (useTourStore.getState().activeUid !== nextUid) {
      useTourStore.getState().bindAccount(nextUid);
    }
    return;
  }

  if (prevUid === null) {
    // First stamp in this browser. Logout keeps AUTH_UID_KEY, so a later
    // signup as a different user hits the account-switch branch below — that
    // is what clears ghost workspace/project IDs, not first stamp.
    clearRoutingPreferences();
    writeStoredAuthUid(nextUid);
    useTourStore.getState().bindAccount(nextUid);
    return;
  }

  // True account switch (different Firebase uid).
  resetClientStores();
  clearRoutingPreferences();
  writeStoredAuthUid(nextUid);
  useTourStore.getState().bindAccount(nextUid);
}
