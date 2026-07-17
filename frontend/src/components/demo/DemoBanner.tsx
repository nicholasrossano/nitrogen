'use client';

import { useRouter } from 'next/navigation';
import { useDemoMode } from '@/hooks/useDemoMode';
import { leaveDemoSession } from '@/lib/demo/demoBoundary';

/**
 * Fixed floating disclaimer for demo mode — bottom-right over the workbench.
 */
export function DemoBanner() {
  const { isDemo } = useDemoMode();
  const router = useRouter();

  if (!isDemo) return null;

  const goToSignup = () => {
    leaveDemoSession();
    router.push('/login?mode=signup');
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[100] w-[min(36rem,calc(100vw-2rem))]"
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
            Browse the workspace and open past chats. Creating projects, uploading files, running assessments, and live AI chat are turned off.
          </p>
        </div>
        <button
          type="button"
          onClick={goToSignup}
          className="h-8 shrink-0 rounded-lg bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Sign up
        </button>
      </div>
    </div>
  );
}
