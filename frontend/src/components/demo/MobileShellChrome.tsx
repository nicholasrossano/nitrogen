'use client';

import { useCallback, useEffect, useState } from 'react';
import { Monitor, X } from 'lucide-react';
import { useDemoMode } from '@/hooks/useDemoMode';
import { useIsMobile } from '@/hooks/useIsMobile';
import { leaveDemoForSignup } from '@/lib/demo/demoBoundary';

// Bump suffix when the notice should reappear for testers who already dismissed.
const DISMISS_KEY = 'nitrogen-landscape-nudge-dismissed-v2';

/**
 * Mobile-only bottom chrome: desktop-optimization notice + demo chip.
 * Desktop demo banner stays in DemoBanner.
 * Stacking: above mobile float (110) + nav chip (120); below modals (200).
 */
export function MobileShellChrome() {
  const isMobile = useIsMobile();
  const { isDemo } = useDemoMode();
  const [nudgeDismissed, setNudgeDismissed] = useState(true);

  useEffect(() => {
    try {
      setNudgeDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setNudgeDismissed(false);
    }
  }, []);

  const dismissNudge = useCallback(() => {
    setNudgeDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  if (!isMobile) return null;

  const showNudge = !nudgeDismissed;
  if (!showNudge && !isDemo) return null;

  return (
    <div
      className="pointer-events-none fixed z-[190] flex items-stretch justify-end gap-2 left-2 right-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      {showNudge ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-auto flex min-h-9 max-w-[14rem] items-center gap-1.5 self-stretch rounded-xl border border-stroke-subtle bg-white/95 px-2.5 py-1.5 shadow-lg backdrop-blur-sm"
        >
          <Monitor className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
          <p className="min-w-0 flex-1 text-xs font-medium leading-snug text-text-primary">
            This experience is optimized for desktop.
          </p>
          <button
            type="button"
            onClick={dismissNudge}
            className="flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-lg text-text-tertiary transition-colors hover:bg-black/[0.04] hover:text-text-primary"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {isDemo ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-auto flex min-h-9 items-center gap-2 self-stretch rounded-xl border border-stroke-subtle bg-white/95 px-2.5 py-1.5 shadow-lg backdrop-blur-sm"
        >
          <span className="inline-flex h-7 items-center rounded-md bg-accent-wash px-2 text-[10px] font-semibold uppercase tracking-wide text-accent">
            Demo mode
          </span>
          <button
            type="button"
            onClick={() => leaveDemoForSignup()}
            className="h-7 shrink-0 rounded-lg bg-accent px-2.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Sign up
          </button>
        </div>
      ) : null}
    </div>
  );
}
