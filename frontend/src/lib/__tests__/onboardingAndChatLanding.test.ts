import { decideChatLandingNavigation } from '@/lib/chatLandingNavigation';
import { shouldFireOnboardingAutoSend } from '@/lib/onboardingAutoSend';

describe('shouldFireOnboardingAutoSend', () => {
  const ready = {
    autoSendOnMount: 'Build a solar plant in Kenya',
    alreadyHandled: false,
    restoreSettled: true,
    allowInitialProjectOnboarding: true,
    loadingChat: false,
    initialChatId: null as string | null,
    currentChatId: null as string | null,
    localMessageCount: 0,
  };

  it('fires once when seed is ready and the thread is empty', () => {
    expect(shouldFireOnboardingAutoSend(ready)).toBe(true);
  });

  it('does not fire before restore settles or onboarding is allowed', () => {
    expect(shouldFireOnboardingAutoSend({ ...ready, restoreSettled: false })).toBe(false);
    expect(shouldFireOnboardingAutoSend({
      ...ready,
      allowInitialProjectOnboarding: false,
    })).toBe(false);
  });

  it('does not fire when a chat or messages already exist', () => {
    expect(shouldFireOnboardingAutoSend({ ...ready, currentChatId: 'chat-1' })).toBe(false);
    expect(shouldFireOnboardingAutoSend({ ...ready, localMessageCount: 1 })).toBe(false);
  });

  it('does not fire twice for the same mount', () => {
    expect(shouldFireOnboardingAutoSend({ ...ready, alreadyHandled: true })).toBe(false);
  });
});

describe('decideChatLandingNavigation', () => {
  it('holds while projects are still loading', () => {
    expect(decideChatLandingNavigation({
      projectsLoaded: false,
      projectsError: null,
      resolvedProjectId: null,
      projectCount: 0,
    })).toEqual({ kind: 'hold' });
  });

  it('surfaces an error instead of treating listProjects failure as empty', () => {
    expect(decideChatLandingNavigation({
      projectsLoaded: true,
      projectsError: 'network down',
      resolvedProjectId: null,
      projectCount: 0,
    })).toEqual({ kind: 'show-error' });
  });

  it('routes to onboarding only when the list truly loaded empty', () => {
    expect(decideChatLandingNavigation({
      projectsLoaded: true,
      projectsError: null,
      resolvedProjectId: null,
      projectCount: 0,
    })).toEqual({ kind: 'goto-onboarding' });
  });

  it('routes to a resolved project when one is available', () => {
    expect(decideChatLandingNavigation({
      projectsLoaded: true,
      projectsError: null,
      resolvedProjectId: 'proj-1',
      projectCount: 2,
    })).toEqual({ kind: 'goto-project', projectId: 'proj-1' });
  });
});
