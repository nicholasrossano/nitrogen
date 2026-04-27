'use client';

import { ReactNode, useEffect } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth';
import { PaywallModal } from '@/components/ui/PaywallModal';
import { useBillingStore } from '@/stores/billingStore';
import { useSettingsStore } from '@/stores/settingsStore';

interface ProvidersProps {
  children: ReactNode;
}

function BillingSync() {
  const { user, loading } = useAuth();
  const devMode = useSettingsStore((s) => s.devMode);
  const fetchBillingStatus = useBillingStore((s) => s.fetchBillingStatus);

  useEffect(() => {
    if (!loading && user && devMode) {
      fetchBillingStatus();
    }
  }, [user, loading, devMode, fetchBillingStatus]);

  return null;
}

function DevModePaywall() {
  const devMode = useSettingsStore((s) => s.devMode);

  if (!devMode) return null;
  return <PaywallModal />;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <AuthProvider>
      <BillingSync />
      {children}
      <DevModePaywall />
    </AuthProvider>
  );
}
