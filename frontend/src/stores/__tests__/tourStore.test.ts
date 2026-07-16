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
      });
    });
  });

  it('starts and finishes the welcome tour', () => {
    act(() => {
      useTourStore.getState().startWelcome('welcome-composer');
    });
    expect(useTourStore.getState().welcomeActive).toBe(true);
    expect(useTourStore.getState().activeStepId).toBe('welcome-composer');

    act(() => {
      useTourStore.getState().finishWelcome();
    });
    expect(useTourStore.getState().welcomeCompleted).toBe(true);
    expect(useTourStore.getState().welcomeActive).toBe(false);
    for (const id of WELCOME_STEP_IDS) {
      expect(useTourStore.getState().completedStepIds).toContain(id);
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
