'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { DEMO_SESSION_EVENT, DEMO_PROJECT_ID, isDemoActive } from '@/lib/demo/demoSession';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // Always start false so SSR and the hydration pass match (sessionStorage is client-only).
  const [demoActive, setDemoActive] = useState(false);
  const [demoChecked, setDemoChecked] = useState(false);

  useEffect(() => {
    const sync = () => setDemoActive(isDemoActive());
    sync();
    setDemoChecked(true);
    window.addEventListener(DEMO_SESSION_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(DEMO_SESSION_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    if (!demoChecked || loading) return;
    if (!user && !demoActive) {
      // Leaving demo briefly clears the flag before /login navigation — never
      // capture the demo project path as returnUrl or sign-in lands back on fixtures.
      const isDemoPath = pathname?.includes(DEMO_PROJECT_ID);
      const returnUrl =
        pathname && pathname !== '/' && !isDemoPath
          ? `?returnUrl=${encodeURIComponent(pathname)}`
          : '';
      router.push(`/login${returnUrl}`);
    }
  }, [user, loading, router, pathname, demoActive, demoChecked]);

  if (loading && !demoActive) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    );
  }

  // Wait for the post-mount sessionStorage read before locking out unauthenticated users.
  if (!user && !demoActive) {
    if (!demoChecked) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-surface">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
        </div>
      );
    }
    return null;
  }

  return <>{children}</>;
}
