'use client';

import { ReactNode, useEffect } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth';
import { PaywallModal } from '@/components/ui/PaywallModal';
import { useBillingStore } from '@/stores/billingStore';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';

interface ProvidersProps {
  children: ReactNode;
}

function BillingSync() {
  const { user, loading } = useAuth();
  const showBillingFeatures = useFeatureFlag('billing_features');
  const fetchBillingStatus = useBillingStore((s) => s.fetchBillingStatus);

  useEffect(() => {
    if (!loading && user && showBillingFeatures) {
      fetchBillingStatus();
    }
  }, [user, loading, showBillingFeatures, fetchBillingStatus]);

  return null;
}

function DevModePaywall() {
  const showPaywallModal = useFeatureFlag('paywall_modal');

  if (!showPaywallModal) return null;
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
