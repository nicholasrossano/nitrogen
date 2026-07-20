import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TourGroup } from '@/lib/tour/tourSteps';
import { WELCOME_STEP_IDS } from '@/lib/tour/tourSteps';

export type TourPrefs = {
  completedStepIds: string[];
  welcomeCompleted: boolean;
};

interface TourState {
  /** Steps the user has finished or skipped (welcome + feature). */
  completedStepIds: string[];
  welcomeCompleted: boolean;
  /** Welcome tour is currently running. */
  welcomeActive: boolean;
  activeStepId: string | null;
  activeGroup: TourGroup | null;
  /** Bumped on replay so the provider re-runs even if already mid-tour. */
  replayNonce: number;
  /** Firebase UID whose prefs are loaded into the active fields above. */
  activeUid: string | null;
  /** Per-account completion — survives logout and account switches in this browser. */
  byUid: Record<string, TourPrefs>;

  /** Load (or claim) prefs for `uid`; pass null on sign-out to clear the active surface. */
  bindAccount: (uid: string | null) => void;
  markStepCompleted: (stepId: string) => void;
  setActiveStep: (stepId: string | null) => void;
  startWelcome: (firstStepId: string) => void;
  /**
   * End the welcome tour. Only mark `visibleStepIds` complete so tips for
   * widgets that were not on screen (e.g. mini context floats) can still fire
   * later when those anchors mount.
   */
  skipWelcome: (visibleStepIds?: string[]) => void;
  finishWelcome: (visibleStepIds?: string[]) => void;
  replayWelcome: () => void;
  startFeatureGroup: (group: TourGroup, firstStepId: string) => void;
  dismissActiveGroup: () => void;
}

const EMPTY_PREFS: TourPrefs = {
  completedStepIds: [],
  welcomeCompleted: false,
};

function withCompleted(ids: string[], stepId: string): string[] {
  if (ids.includes(stepId)) return ids;
  return [...ids, stepId];
}

function writeThrough(
  get: () => TourState,
  patch: Partial<Pick<TourState, 'completedStepIds' | 'welcomeCompleted'>> &
    Partial<TourState>,
): Partial<TourState> {
  const state = get();
  const completedStepIds = patch.completedStepIds ?? state.completedStepIds;
  const welcomeCompleted = patch.welcomeCompleted ?? state.welcomeCompleted;
  if (!state.activeUid) {
    return { ...patch, completedStepIds, welcomeCompleted };
  }
  return {
    ...patch,
    completedStepIds,
    welcomeCompleted,
    byUid: {
      ...state.byUid,
      [state.activeUid]: { completedStepIds, welcomeCompleted },
    },
  };
}

function endWelcomeTour(visibleStepIds: string[] | undefined, get: () => TourState) {
  const completed = new Set(get().completedStepIds);
  for (const id of visibleStepIds ?? []) {
    if (WELCOME_STEP_IDS.includes(id)) completed.add(id);
  }
  return writeThrough(get, {
    completedStepIds: Array.from(completed),
    welcomeCompleted: true,
    welcomeActive: false,
    activeGroup: null,
    activeStepId: null,
  });
}

export const useTourStore = create<TourState>()(
  persist(
    (set, get) => ({
      completedStepIds: [],
      welcomeCompleted: false,
      welcomeActive: false,
      activeStepId: null,
      activeGroup: null,
      replayNonce: 0,
      activeUid: null,
      byUid: {},

      bindAccount: (uid) => {
        const state = get();
        if (uid && state.activeUid === uid) return;

        let byUid = { ...state.byUid };

        // Flush the outgoing account before swapping.
        if (state.activeUid) {
          byUid[state.activeUid] = {
            completedStepIds: state.completedStepIds,
            welcomeCompleted: state.welcomeCompleted,
          };
        }

        if (!uid) {
          set({
            activeUid: null,
            completedStepIds: [],
            welcomeCompleted: false,
            welcomeActive: false,
            activeStepId: null,
            activeGroup: null,
            byUid,
          });
          return;
        }

        const existing = byUid[uid];
        if (existing) {
          set({
            activeUid: uid,
            completedStepIds: existing.completedStepIds,
            welcomeCompleted: existing.welcomeCompleted,
            welcomeActive: false,
            activeStepId: null,
            activeGroup: null,
            byUid,
          });
          return;
        }

        // First bind for this uid: claim orphan active prefs (pre-v1 single-key
        // storage, or completion recorded before auth stamped the uid).
        const claimOrphan =
          state.activeUid === null &&
          (state.welcomeCompleted || state.completedStepIds.length > 0);
        const prefs: TourPrefs = claimOrphan
          ? {
              completedStepIds: state.completedStepIds,
              welcomeCompleted: state.welcomeCompleted,
            }
          : { ...EMPTY_PREFS };
        byUid[uid] = prefs;
        set({
          activeUid: uid,
          completedStepIds: prefs.completedStepIds,
          welcomeCompleted: prefs.welcomeCompleted,
          welcomeActive: false,
          activeStepId: null,
          activeGroup: null,
          byUid,
        });
      },

      markStepCompleted: (stepId) => {
        set(writeThrough(get, {
          completedStepIds: withCompleted(get().completedStepIds, stepId),
        }));
      },

      setActiveStep: (stepId) => {
        set({ activeStepId: stepId });
      },

      startWelcome: (firstStepId) => {
        set(writeThrough(get, {
          welcomeActive: true,
          welcomeCompleted: false,
          activeGroup: 'welcome',
          activeStepId: firstStepId,
        }));
      },

      skipWelcome: (visibleStepIds) => {
        set(endWelcomeTour(visibleStepIds, get));
      },

      finishWelcome: (visibleStepIds) => {
        set(endWelcomeTour(visibleStepIds, get));
      },

      replayWelcome: () => {
        const completed = get().completedStepIds.filter((id) => !WELCOME_STEP_IDS.includes(id));
        set(writeThrough(get, {
          completedStepIds: completed,
          welcomeCompleted: false,
          welcomeActive: false,
          activeGroup: null,
          activeStepId: null,
          replayNonce: get().replayNonce + 1,
        }));
      },

      startFeatureGroup: (group, firstStepId) => {
        if (get().welcomeActive) return;
        set({
          activeGroup: group,
          activeStepId: firstStepId,
        });
      },

      dismissActiveGroup: () => {
        const { activeGroup, activeStepId, completedStepIds, welcomeCompleted, welcomeActive } = get();
        if (!activeGroup) return;
        let nextCompleted = completedStepIds;
        if (activeStepId) {
          nextCompleted = withCompleted(completedStepIds, activeStepId);
        }
        if (activeGroup === 'welcome' && welcomeActive && !welcomeCompleted) {
          // First-run welcome dismissed via overlay without going through
          // finish/skip — only burn the active tip, leave deferred ones open.
          set(writeThrough(get, {
            completedStepIds: nextCompleted,
            welcomeCompleted: true,
            welcomeActive: false,
            activeGroup: null,
            activeStepId: null,
          }));
          return;
        }
        set(writeThrough(get, {
          completedStepIds: nextCompleted,
          activeGroup: null,
          activeStepId: null,
        }));
      },
    }),
    {
      name: 'nitrogen-tour',
      version: 1,
      migrate: (persisted, version) => {
        const raw = (persisted ?? {}) as Record<string, unknown>;
        if (version >= 1 && raw.byUid && typeof raw.byUid === 'object') {
          return raw as TourPrefs & {
            byUid: Record<string, TourPrefs>;
            activeUid: string | null;
            completedStepIds: string[];
            welcomeCompleted: boolean;
          };
        }
        // v0: flat completedStepIds / welcomeCompleted — keep as orphan active
        // prefs so the next bindAccount can claim them for that Firebase uid.
        return {
          byUid: {},
          activeUid: null,
          completedStepIds: Array.isArray(raw.completedStepIds)
            ? (raw.completedStepIds as string[])
            : [],
          welcomeCompleted: Boolean(raw.welcomeCompleted),
        };
      },
      partialize: (state) => ({
        completedStepIds: state.completedStepIds,
        welcomeCompleted: state.welcomeCompleted,
        activeUid: state.activeUid,
        byUid: state.byUid,
      }),
    },
  ),
);
