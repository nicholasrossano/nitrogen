'use client';

import { useEffect, useState } from 'react';
import { DEMO_SESSION_EVENT, isDemoActive } from '@/lib/demo/demoSession';

/** Reactive demo session flag (same-tab + cross-tab). */
export function useDemoMode(): { isDemo: boolean } {
  const [isDemo, setIsDemo] = useState(() => isDemoActive());

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
