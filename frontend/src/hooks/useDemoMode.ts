'use client';

import { useEffect, useState } from 'react';
import { DEMO_SESSION_EVENT, isDemoActive } from '@/lib/demo/demoSession';

/**
 * Reactive demo session flag (same-tab + cross-tab).
 * Starts false on server and first client paint so SSR/hydration match;
 * sessionStorage is read only after mount.
 */
export function useDemoMode(): { isDemo: boolean } {
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    const sync = () => setIsDemo(isDemoActive());
    sync();
    window.addEventListener(DEMO_SESSION_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(DEMO_SESSION_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return { isDemo };
}
