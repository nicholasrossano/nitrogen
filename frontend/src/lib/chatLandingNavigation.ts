/**
 * Decide where /chat should send the user after the workspace project list load.
 *
 * Critical invariant: a failed listProjects call is not "empty workspace".
 * Treating failures as empty bounced paying users into /projects/new.
 */
export type ChatLandingDecision =
  | { kind: 'hold' }
  | { kind: 'show-error' }
  | { kind: 'goto-project'; projectId: string }
  | { kind: 'goto-onboarding' }
  | { kind: 'show-personal-chat' };

export function decideChatLandingNavigation(opts: {
  projectsLoaded: boolean;
  projectsError: string | null;
  resolvedProjectId: string | null;
  projectCount: number;
}): ChatLandingDecision {
  if (!opts.projectsLoaded) return { kind: 'hold' };
  if (opts.projectsError) return { kind: 'show-error' };
  if (opts.resolvedProjectId) {
    return { kind: 'goto-project', projectId: opts.resolvedProjectId };
  }
  if (opts.projectCount === 0) return { kind: 'goto-onboarding' };
  return { kind: 'show-personal-chat' };
}
