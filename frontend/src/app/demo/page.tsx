'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { buildDemoProjectPath } from '@/lib/demo/demoSession';
import { startDemoSession } from '@/lib/demo/demoBoundary';

/**
 * Public entry for marketing / “try the demo” links.
 * Signs out any real session, resets client stores, then opens the mock project.
 */
export default function DemoEntryPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const startedRef = useRef(false);

  useEffect(() => {
    if (loading || startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      await startDemoSession({
        hasUser: Boolean(user),
        signOut,
      });
      router.replace(buildDemoProjectPath());
    })();
  }, [loading, user, signOut, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-text-secondary">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
        <p className="text-sm">Opening demo…</p>
      </div>
    </div>
  );
}
