import { act } from '@testing-library/react';
import { useTourStore } from '@/stores/tourStore';
import { WELCOME_STEP_IDS } from '@/lib/tour/tourSteps';

describe('tourStore', () => {
  beforeEach(() => {
    act(() => {
      useTourStore.setState({
        completedStepIds: [],
        welcomeCompleted: false,
        welcomeActive: false,
        activeStepId: null,
        activeGroup: null,
        replayNonce: 0,
        activeUid: 'user-a',
        byUid: {},
      });
    });
  });

  it('starts and finishes the welcome tour without burning invisible tips', () => {
    act(() => {
      useTourStore.getState().startWelcome('welcome-composer');
    });
    expect(useTourStore.getState().welcomeActive).toBe(true);
    expect(useTourStore.getState().activeStepId).toBe('welcome-composer');

    act(() => {
      useTourStore.getState().finishWelcome(['welcome-composer', 'welcome-workspace']);
    });
    expect(useTourStore.getState().welcomeCompleted).toBe(true);
    expect(useTourStore.getState().welcomeActive).toBe(false);
    expect(useTourStore.getState().completedStepIds).toEqual([
      'welcome-composer',
      'welcome-workspace',
    ]);
    expect(useTourStore.getState().completedStepIds).not.toContain('welcome-context-stack');
    expect(useTourStore.getState().byUid['user-a']).toEqual({
      completedStepIds: ['welcome-composer', 'welcome-workspace'],
      welcomeCompleted: true,
    });
  });

  it('keeps per-account prefs across bindAccount switches and logout', () => {
    act(() => {
      useTourStore.getState().finishWelcome(['welcome-composer']);
      useTourStore.getState().bindAccount('user-b');
    });
    expect(useTourStore.getState().welcomeCompleted).toBe(false);
    expect(useTourStore.getState().byUid['user-a']?.welcomeCompleted).toBe(true);

    act(() => {
      useTourStore.getState().bindAccount(null);
    });
    expect(useTourStore.getState().activeUid).toBeNull();
    expect(useTourStore.getState().welcomeCompleted).toBe(false);

    act(() => {
      useTourStore.getState().bindAccount('user-a');
    });
    expect(useTourStore.getState().welcomeCompleted).toBe(true);
    expect(useTourStore.getState().completedStepIds).toEqual(['welcome-composer']);
  });

  it('skip welcome only completes currently visible tips', () => {
    act(() => {
      useTourStore.getState().startWelcome('welcome-composer');
      useTourStore.getState().skipWelcome(['welcome-composer']);
    });
    expect(useTourStore.getState().welcomeCompleted).toBe(true);
    expect(useTourStore.getState().completedStepIds).toEqual(['welcome-composer']);
    for (const id of WELCOME_STEP_IDS) {
      if (id === 'welcome-composer') continue;
      expect(useTourStore.getState().completedStepIds).not.toContain(id);
    }
  });

  it('replays welcome without clearing unrelated completed feature tips', () => {
    act(() => {
      useTourStore.setState({
        completedStepIds: [...WELCOME_STEP_IDS, 'feature-assessments'],
        welcomeCompleted: true,
      });
      useTourStore.getState().replayWelcome();
    });

    const state = useTourStore.getState();
    expect(state.welcomeCompleted).toBe(false);
    expect(state.replayNonce).toBe(1);
    expect(state.completedStepIds).toEqual(['feature-assessments']);
    expect(state.completedStepIds).not.toContain('welcome-composer');
  });

  it('does not start a feature tip while welcome is active', () => {
    act(() => {
      useTourStore.getState().startWelcome('welcome-composer');
      useTourStore.getState().startFeatureGroup('feature-assessments', 'feature-assessments');
    });
    expect(useTourStore.getState().activeGroup).toBe('welcome');
    expect(useTourStore.getState().activeStepId).toBe('welcome-composer');
  });
});
