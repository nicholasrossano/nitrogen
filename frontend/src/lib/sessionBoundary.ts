/**
 * Auth / account session boundary.
 *
 * Workspace, last-project, and tour prefs are browser-local and historically
 * not scoped by Firebase UID. Crossing accounts in the same browser must clear
 * them so a new user does not inherit another account's IDs (404 Workspace /
 * Project not found) or skip the welcome tour.
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
  useProjectStore.setState({ projectsById: {} });
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

function clearTourPreferences(): void {
  if (typeof window === 'undefined') return;
  try {
    // Drop persisted tour state so Zustand rehydrate cannot resurrect another
    // account's welcomeCompleted and skip tips for a new signup.
    localStorage.removeItem('nitrogen-tour');
  } catch {
    // ignore
  }
  useTourStore.setState({
    completedStepIds: [],
    welcomeCompleted: false,
    welcomeActive: false,
    activeStepId: null,
    activeGroup: null,
  });
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
 * - Same UID: no-op (preserves prefs across refresh / re-login).
 * - First stamp (prevUid null): record uid + scrub orphan routing keys only.
 *   Do NOT wipe in-memory stores or tour — that blanked Overview / Home title
 *   on live projects that had already loaded for the signed-in user.
 * - UID change: clear stores, routing prefs, and tour (true account switch).
 * - Sign-out (null): clear in-memory stores only; keep stored UID so the same
 *   user can sign back in without losing prefs.
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
    return;
  }

  if (prevUid === nextUid) return;

  if (prevUid === null) {
    // First stamp in this browser. Logout keeps AUTH_UID_KEY, so a later
    // signup as a different user hits the account-switch branch below — that
    // is what clears ghost workspace/project IDs, not first stamp.
    clearRoutingPreferences();
    writeStoredAuthUid(nextUid);
    return;
  }

  // True account switch (different Firebase uid).
  resetClientStores();
  clearRoutingPreferences();
  clearTourPreferences();
  writeStoredAuthUid(nextUid);
}
