'use client';

import { ReactNode, useEffect } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth';
import { PaywallModal } from '@/components/ui/PaywallModal';
import { useBillingStore } from '@/stores/billingStore';
import { useDemoMode } from '@/hooks/useDemoMode';

interface ProvidersProps {
  children: ReactNode;
}

function BillingSync() {
  const { user, loading } = useAuth();
  const { isDemo } = useDemoMode();
  const fetchBillingStatus = useBillingStore((s) => s.fetchBillingStatus);

  useEffect(() => {
    if (!loading && user && !isDemo) {
      void fetchBillingStatus();
    }
  }, [user, loading, isDemo, fetchBillingStatus]);

  return null;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <AuthProvider>
      <BillingSync />
      {children}
      <PaywallModal />
    </AuthProvider>
  );
}
