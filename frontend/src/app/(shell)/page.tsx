'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageLoader } from '@/components/ui/PageLoader';

/**
 * Entry redirect. Always go through /chat so empty Personal workspaces
 * auto-create the first project (and stale last-project ids are not used).
 * Panel deep-links are preserved as query params for the chat resolver.
 */
export default function HomeRedirectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const params = new URLSearchParams();
    const view = searchParams.get('view');
    const panel = searchParams.get('panel');
    if (view === 'files' || panel === 'files') {
      params.set('panel', 'files');
    } else if (
      panel === 'overview'
      || panel === 'variables'
      || panel === 'framework'
      || panel === 'assessments'
    ) {
      params.set('panel', panel === 'framework' ? 'assessments' : panel);
    }
    const query = params.toString();
    router.replace(query ? `/chat?${query}` : '/chat');
  }, [router, searchParams]);

  return (
    <div className="flex-1 flex items-center justify-center min-h-full w-full bg-surface">
      <PageLoader label="" />
    </div>
  );
}
