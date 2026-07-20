'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import {
  beginDemoEntry,
  buildDemoProjectPath,
  endDemoEntry,
  enterDemo,
} from '@/lib/demo/demoSession';
import { startDemoSession } from '@/lib/demo/demoBoundary';
import { UniversalLoadingIcon } from '@/components/ui/PageLoader';

/**
 * Public entry for marketing / “try the demo” links.
 * Signs out any real session, resets client stores, then opens the mock project.
 */
export default function DemoEntryPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const startedRef = useRef(false);

  useEffect(() => {
    // Claim demo immediately — do not wait for Firebase. Otherwise a signed-in
    // visitor can lose the race to ProtectedRoute and land on /login.
    if (!startedRef.current) {
      beginDemoEntry();
      enterDemo();
    }

    if (loading) {
      return () => {
        if (!startedRef.current) endDemoEntry();
      };
    }

    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    void (async () => {
      await startDemoSession({
        hasUser: Boolean(user),
        signOut,
      });
      if (!cancelled) {
        router.replace(buildDemoProjectPath());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, user, signOut, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-text-secondary">
        <UniversalLoadingIcon size={40} />
        <p className="text-sm">Opening demo…</p>
      </div>
    </div>
  );
}
