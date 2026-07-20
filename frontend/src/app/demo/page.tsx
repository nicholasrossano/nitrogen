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
  // Always-current auth snapshots — read once when bootstrap starts so signing
  // out (user → null) cannot re-enter the effect and cancel navigation.
  const userRef = useRef(user);
  const signOutRef = useRef(signOut);
  userRef.current = user;
  signOutRef.current = signOut;

  // Claim demo immediately on mount so a slow Firebase init cannot bounce the
  // visitor to /login if they somehow reach a protected route mid-bootstrap.
  useEffect(() => {
    beginDemoEntry();
    enterDemo();
    return () => {
      if (!startedRef.current) {
        endDemoEntry();
      }
    };
  }, []);

  useEffect(() => {
    if (loading || startedRef.current) return;

    startedRef.current = true;
    const hasUser = Boolean(userRef.current);
    const signOutFn = signOutRef.current;

    void (async () => {
      try {
        await startDemoSession({
          hasUser,
          signOut: signOutFn,
        });
        // Always navigate — do not gate on an effect "cancelled" flag. Signing
        // out a restored Firebase session flips `user`, which used to cancel
        // this replace and leave the page stuck on "Opening demo…".
        router.replace(buildDemoProjectPath());
      } catch (err) {
        console.error('Failed to start demo session:', err);
        startedRef.current = false;
        endDemoEntry();
        beginDemoEntry();
        enterDemo();
      }
    })();
  }, [loading, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-text-secondary">
        <UniversalLoadingIcon size={40} />
        <p className="text-sm">Opening demo…</p>
      </div>
    </div>
  );
}
