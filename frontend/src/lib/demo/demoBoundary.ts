/**
 * Hard boundary between demo and real sessions.
 * Demo is sessionStorage-only; real prefs live in localStorage. Crossing either
 * direction must clear in-memory stores so the two never render mixed data.
 */

import { useProjectStore } from '@/stores/projectStore';
import { invalidateWorkspaceLoads, useWorkspaceStore } from '@/stores/workspaceStore';
import { useBillingStore } from '@/stores/billingStore';
import { clearSwrCache } from '@/lib/swrCache';
import { DEMO_PROJECT_ID, enterDemo, exitDemo, isDemoActive } from '@/lib/demo/demoSession';

const LAST_PROJECT_KEY = 'nitrogen-last-project-id';

export function resetClientStateForDemoBoundary(): void {
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
  // Never leave a demo project id as the post-login landing preference.
  try {
    if (typeof window !== 'undefined' && localStorage.getItem(LAST_PROJECT_KEY) === DEMO_PROJECT_ID) {
      localStorage.removeItem(LAST_PROJECT_KEY);
    }
  } catch {
    // ignore
  }
}

/**
 * Enter demo with a clean break from any real session.
 * Callers that may have a Firebase user must pass signOut.
 */
export async function startDemoSession(options?: {
  signOut?: () => Promise<void>;
  hasUser?: boolean;
}): Promise<void> {
  if (options?.hasUser && options.signOut) {
    try {
      await options.signOut();
    } catch {
      // Still proceed — enterDemo + auth guard will refuse to mix if sign-out failed.
    }
  }
  resetClientStateForDemoBoundary();
  enterDemo();
}

/** Leave demo before login/signup or when a real Firebase session appears. */
export function leaveDemoSession(): void {
  if (!isDemoActive()) {
    resetClientStateForDemoBoundary();
    return;
  }
  exitDemo();
  resetClientStateForDemoBoundary();
}
