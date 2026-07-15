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
  skipWelcome: () => void;
  finishWelcome: () => void;
  replayWelcome: () => void;
  startFeatureGroup: (group: TourGroup, firstStepId: string) => void;
  dismissActiveGroup: () => void;
}

function withCompleted(ids: string[], stepId: string): string[] {
  if (ids.includes(stepId)) return ids;
  return [...ids, stepId];
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

      skipWelcome: () => {
        const completed = new Set(get().completedStepIds);
        for (const id of WELCOME_STEP_IDS) completed.add(id);
        set({
          completedStepIds: Array.from(completed),
          welcomeCompleted: true,
          welcomeActive: false,
          activeGroup: null,
          activeStepId: null,
        });
      },

      finishWelcome: () => {
        const completed = new Set(get().completedStepIds);
        for (const id of WELCOME_STEP_IDS) completed.add(id);
        set({
          completedStepIds: Array.from(completed),
          welcomeCompleted: true,
          welcomeActive: false,
          activeGroup: null,
          activeStepId: null,
        });
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
        const { activeGroup, activeStepId, completedStepIds } = get();
        if (!activeGroup) return;
        let nextCompleted = completedStepIds;
        if (activeStepId) {
          nextCompleted = withCompleted(completedStepIds, activeStepId);
        }
        if (activeGroup === 'welcome') {
          const completed = new Set(nextCompleted);
          for (const id of WELCOME_STEP_IDS) completed.add(id);
          set({
            completedStepIds: Array.from(completed),
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
