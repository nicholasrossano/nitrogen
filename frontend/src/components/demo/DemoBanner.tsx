'use client';

import { useDemoMode } from '@/hooks/useDemoMode';
import { leaveDemoForSignup } from '@/lib/demo/demoBoundary';

/**
 * Desktop demo disclaimer (bottom-right card).
 * Mobile chip lives in MobileShellChrome next to the desktop-optimization notice.
 */
export function DemoBanner() {
  const { isDemo } = useDemoMode();

  if (!isDemo) return null;

  const goToSignup = () => {
    leaveDemoForSignup();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[100] w-[min(36rem,calc(100vw-2rem))] max-md:hidden"
    >
      <div className="pointer-events-auto flex flex-col items-stretch gap-2 rounded-xl border border-stroke-subtle bg-white/95 px-4 py-3 shadow-lg backdrop-blur-sm sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-accent-wash px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
              Demo mode
            </span>
            <p className="text-sm font-medium text-text-primary">
              Sample project. Most actions are disabled.
            </p>
          </div>
          <p className="mt-0.5 text-xs text-text-secondary">
            Browse the workspace, open past chats, and try sending a message for a short feature overview. Creating projects, uploading files, running assessments, and live AI are turned off.
          </p>
        </div>
        <button
          type="button"
          onClick={goToSignup}
          className="h-8 shrink-0 rounded-lg bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-hover max-md:min-h-11 max-md:px-3.5"
        >
          Sign up
        </button>
      </div>
    </div>
  );
}
