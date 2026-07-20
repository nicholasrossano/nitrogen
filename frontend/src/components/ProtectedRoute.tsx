'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { needsEmailVerification, useAuth } from '@/lib/auth';
import { isProjectResumePath } from '@/lib/authReturnUrl';
import { DEMO_SESSION_EVENT, isDemoActive, isDemoProjectPath, isLeavingDemoForAuth } from '@/lib/demo/demoSession';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

function loginRedirect(pathname: string | null, mode?: 'verify'): string {
  const params = new URLSearchParams();
  if (mode) params.set('mode', mode);
  // Never park a project id on /login — stale/demo/cross-account resumes 404
  // after auth. Non-project paths (e.g. settings) still deep-link back.
  if (pathname && pathname !== '/' && !isProjectResumePath(pathname)) {
    params.set('returnUrl', pathname);
  }
  const query = params.toString();
  return query ? `/login?${query}` : '/login';
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // Always start false so SSR and the hydration pass match (sessionStorage is client-only).
  const [demoActive, setDemoActive] = useState(false);
  const [demoChecked, setDemoChecked] = useState(false);
  const mustVerify = needsEmailVerification(user);

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
      // Orphaned / shared demo project URLs must re-bootstrap via /demo —
      // never send visitors to login when they asked for the sample project.
      // Skip while Sign up is intentionally leaving demo for /login.
      if (isDemoProjectPath(pathname) && !isLeavingDemoForAuth()) {
        router.replace('/demo');
        return;
      }
      router.push(loginRedirect(pathname));
      return;
    }
    // Demo sessions skip email verification; real accounts must verify first.
    if (user && mustVerify && !demoActive) {
      router.replace(loginRedirect(pathname, 'verify'));
    }
  }, [user, loading, router, pathname, demoActive, demoChecked, mustVerify]);

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

  if (user && mustVerify && !demoActive) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
