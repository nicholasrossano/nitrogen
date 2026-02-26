/**
 * Minimal analytics module.
 *
 * Logs to console.debug in development.
 * Swap the implementation of `track` for Mixpanel / Segment / PostHog
 * when a production provider is added -- this is the single integration point.
 */

const IS_DEV =
  typeof window !== 'undefined' && process.env.NODE_ENV === 'development';

export function track(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (IS_DEV) {
    console.debug(`[analytics] ${event}`, properties ?? '');
  }
}
