import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TourGroup } from '@/lib/tour/tourSteps';
import { WELCOME_STEP_IDS } from '@/lib/tour/tourSteps';

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

function withCompleted(ids: string[], stepId: string): string[] {
  if (ids.includes(stepId)) return ids;
  return [...ids, stepId];
}

function endWelcomeTour(visibleStepIds: string[] | undefined, get: () => TourState) {
  const completed = new Set(get().completedStepIds);
  for (const id of visibleStepIds ?? []) {
    if (WELCOME_STEP_IDS.includes(id)) completed.add(id);
  }
  return {
    completedStepIds: Array.from(completed),
    welcomeCompleted: true,
    welcomeActive: false,
    activeGroup: null as TourGroup | null,
    activeStepId: null as string | null,
  };
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

      markStepCompleted: (stepId) => {
        set({ completedStepIds: withCompleted(get().completedStepIds, stepId) });
      },

      setActiveStep: (stepId) => {
        set({ activeStepId: stepId });
      },

      startWelcome: (firstStepId) => {
        set({
          welcomeActive: true,
          welcomeCompleted: false,
          activeGroup: 'welcome',
          activeStepId: firstStepId,
        });
      },

      skipWelcome: (visibleStepIds) => {
        set(endWelcomeTour(visibleStepIds, get));
      },

      finishWelcome: (visibleStepIds) => {
        set(endWelcomeTour(visibleStepIds, get));
      },

      replayWelcome: () => {
        const completed = get().completedStepIds.filter((id) => !WELCOME_STEP_IDS.includes(id));
        set({
          completedStepIds: completed,
          welcomeCompleted: false,
          welcomeActive: false,
          activeGroup: null,
          activeStepId: null,
          replayNonce: get().replayNonce + 1,
        });
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
          set({
            completedStepIds: nextCompleted,
            welcomeCompleted: true,
            welcomeActive: false,
            activeGroup: null,
            activeStepId: null,
          });
          return;
        }
        set({
          completedStepIds: nextCompleted,
          activeGroup: null,
          activeStepId: null,
        });
      },
    }),
    {
      name: 'nitrogen-tour',
      partialize: (state) => ({
        completedStepIds: state.completedStepIds,
        welcomeCompleted: state.welcomeCompleted,
      }),
    },
  ),
);
