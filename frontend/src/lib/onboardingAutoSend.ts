/**
 * Gate for the one-shot ?seed= auto-send after /projects/new creates a project.
 * Kept pure so race regressions (send before restore / before onboarding flag /
 * when a chat already exists) stay unit-testable.
 */
export function shouldFireOnboardingAutoSend(opts: {
  autoSendOnMount: string | null | undefined;
  alreadyHandled: boolean;
  restoreSettled: boolean;
  allowInitialProjectOnboarding: boolean;
  loadingChat: boolean;
  initialChatId: string | null | undefined;
  currentChatId: string | null | undefined;
  localMessageCount: number;
}): boolean {
  if (!opts.autoSendOnMount) return false;
  if (opts.alreadyHandled) return false;
  if (!opts.restoreSettled) return false;
  if (!opts.allowInitialProjectOnboarding) return false;
  if (opts.loadingChat) return false;
  if (opts.initialChatId || opts.currentChatId) return false;
  if (opts.localMessageCount > 0) return false;
  return true;
}
