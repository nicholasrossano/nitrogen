'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, ArrowLeft, Loader2, CreditCard } from 'lucide-react';
import { useBillingStore } from '@/stores/billingStore';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { BillingOptionsPanel } from '@/components/ui/BillingOptionsPanel';

function SubscribeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    fetchBillingStatus,
    loading: billingLoading,
  } = useBillingStore();

  const success = searchParams.get('success') === 'true';
  const canceled = searchParams.get('canceled') === 'true';

  useEffect(() => {
    fetchBillingStatus();
  }, [fetchBillingStatus]);

  useEffect(() => {
    if (success) {
      fetchBillingStatus();
      const timer = setTimeout(() => router.push('/'), 2000);
      return () => clearTimeout(timer);
    }
  }, [success, router, fetchBillingStatus]);

  if (success) {
    return (
      <div className="h-screen flex flex-col bg-white">
        <header className="shrink-0 h-14" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto">
              <Check className="w-8 h-8 text-emerald-600" />
            </div>
            <h1 className="text-2xl font-semibold text-text-primary">
              Subscription activated!
            </h1>
            <p className="text-text-secondary">
              Redirecting to your dashboard...
            </p>
            <Loader2 className="w-5 h-5 animate-spin text-text-tertiary mx-auto" />
          </div>
        </div>
      </div>
    );
  }

  if (canceled) {
    return (
      <div className="h-screen flex flex-col bg-white">
        <header className="shrink-0 h-14" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-surface-subtle flex items-center justify-center mx-auto">
              <CreditCard className="w-8 h-8 text-text-tertiary" />
            </div>
            <h1 className="text-2xl font-semibold text-text-primary">
              Checkout canceled
            </h1>
            <p className="text-text-secondary">
              No worries — you can try again whenever you&apos;re ready.
            </p>
            <button
              onClick={() => router.replace('/subscribe')}
              className="btn-primary mt-2"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      <header className="shrink-0 h-14 px-6 flex items-center">
        <button
          onClick={() => router.push('/')}
          className="flex items-center gap-1.5 text-sm text-text-secondary enabled:hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </button>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-6 py-10">
          <div className="text-center mb-10">
            <h1 className="text-3xl font-semibold text-text-primary">
              Choose your plan
            </h1>
            <p className="mt-2 text-text-secondary">
              Start building carbon projects with the tools you need.
            </p>
          </div>

          {billingLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 text-accent animate-spin" />
            </div>
          ) : (
            <>
              <div className="max-w-2xl mx-auto">
                <BillingOptionsPanel onByokSaved={() => router.push('/')} />
              </div>
              <p className="mt-10 text-center text-sm text-text-tertiary">
                Already subscribed?{' '}
                <button
                  onClick={() => router.push('/')}
                  className="text-accent enabled:hover:underline"
                >
                  Go to dashboard
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SubscribePage() {
  return (
    <ProtectedRoute>
      <Suspense
        fallback={
          <div className="h-screen flex flex-col bg-white">
            <header className="shrink-0 h-14" />
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-accent animate-spin" />
            </div>
          </div>
        }
      >
        <SubscribeContent />
      </Suspense>
    </ProtectedRoute>
  );
}
