'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Key, CreditCard, ArrowLeft, Loader2, ChevronDown } from 'lucide-react';
import { api } from '@/lib/api';
import { useBillingStore } from '@/stores/billingStore';
import { ProtectedRoute } from '@/components/ProtectedRoute';

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: '$20',
    period: '/mo',
    description: 'For individuals getting started with carbon project design.',
    features: [
      'Up to $20 in AI usage',
      'All core tools',
      'PDF & DOCX exports',
      'Email support',
    ],
    priceEnvKey: 'NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID',
    accent: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$60',
    period: '/mo',
    description: 'For teams and power users with higher volume needs.',
    features: [
      'Up to $60 in AI usage',
      'Everything in Starter',
      'Priority processing',
      'Advanced analytics',
      'Priority support',
    ],
    priceEnvKey: 'NEXT_PUBLIC_STRIPE_PRO_PRICE_ID',
    accent: true,
  },
  {
    id: 'byok',
    name: 'Bring Your Own Key',
    price: 'Free',
    period: '',
    description: 'Use your own OpenAI API key. No subscription required.',
    features: [
      'Unlimited usage',
      'All core tools',
      'Your own API key',
      'Full data control',
    ],
    priceEnvKey: null,
    accent: false,
  },
] as const;

function SubscribeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    fetchBillingStatus,
    redeemAccessCode,
    accessCodeAvailable,
    loading: billingLoading,
  } = useBillingStore();

  const success = searchParams.get('success') === 'true';
  const canceled = searchParams.get('canceled') === 'true';

  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [byokKey, setByokKey] = useState('');
  const [byokSaving, setByokSaving] = useState(false);
  const [byokError, setByokError] = useState<string | null>(null);
  const [byokSuccess, setByokSuccess] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [accessCodeOpen, setAccessCodeOpen] = useState(false);
  const [accessCodeError, setAccessCodeError] = useState<string | null>(null);
  const [accessCodeLoading, setAccessCodeLoading] = useState(false);

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

  const handleCheckout = useCallback(async (planId: string) => {
    const priceId =
      planId === 'starter'
        ? process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID
        : process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID;

    if (!priceId) return;

    setCheckoutLoading(planId);
    try {
      const successUrl = `${window.location.origin}/subscribe?success=true`;
      const cancelUrl = `${window.location.origin}/subscribe?canceled=true`;
      const { url } = await api.createCheckout(priceId, successUrl, cancelUrl);
      window.location.href = url;
    } catch {
      setCheckoutLoading(null);
    }
  }, []);

  const handleByokSave = useCallback(async () => {
    if (!byokKey.trim()) return;
    setByokSaving(true);
    setByokError(null);
    try {
      await api.storeApiKey(byokKey.trim(), 'openai');
      setByokSuccess(true);
      setByokKey('');
      await fetchBillingStatus();
    } catch (e: unknown) {
      setByokError(e instanceof Error ? e.message : 'Failed to save key');
    } finally {
      setByokSaving(false);
    }
  }, [byokKey, fetchBillingStatus]);

  const handleRedeemCode = useCallback(async () => {
    if (!accessCode.trim()) return;
    setAccessCodeLoading(true);
    setAccessCodeError(null);
    try {
      const result = await redeemAccessCode(accessCode.trim());
      if (result.success) {
        router.push('/');
      } else {
        setAccessCodeError(result.error || 'Invalid code');
      }
    } catch {
      setAccessCodeError('Failed to redeem code');
    } finally {
      setAccessCodeLoading(false);
    }
  }, [accessCode, redeemAccessCode, router]);

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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {PLANS.map((plan) => (
                  <div
                    key={plan.id}
                    className={`relative rounded-2xl border p-6 flex flex-col ${
                      plan.accent
                        ? 'border-accent bg-accent/[0.03] shadow-sm'
                        : 'border-stroke-subtle bg-white'
                    }`}
                  >
                    {plan.accent && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-accent text-white text-[11px] font-medium px-3 py-0.5 rounded-full">
                        Most popular
                      </span>
                    )}

                    <div className="mb-5">
                      <h2 className="text-lg font-semibold text-text-primary">
                        {plan.name}
                      </h2>
                      <div className="mt-2 flex items-baseline gap-0.5">
                        <span className="text-3xl font-bold text-text-primary">
                          {plan.price}
                        </span>
                        {plan.period && (
                          <span className="text-sm text-text-tertiary">
                            {plan.period}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-text-secondary leading-relaxed">
                        {plan.description}
                      </p>
                    </div>

                    <ul className="space-y-2.5 mb-6 flex-1">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm text-text-secondary">
                          <Check className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                          {f}
                        </li>
                      ))}
                    </ul>

                    {plan.id === 'byok' ? (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <input
                            type="password"
                            placeholder="sk-..."
                            value={byokKey}
                            onChange={(e) => {
                              setByokKey(e.target.value);
                              setByokError(null);
                              setByokSuccess(false);
                            }}
                            className="flex-1 h-9 px-3 text-sm rounded-lg border border-stroke-subtle bg-surface-subtle text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none transition-colors"
                          />
                          <button
                            onClick={handleByokSave}
                            disabled={byokSaving || !byokKey.trim()}
                            className="btn-primary !h-9 !px-4 !text-sm shrink-0"
                          >
                            {byokSaving ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Key className="w-3.5 h-3.5" />
                            )}
                            Save
                          </button>
                        </div>
                        {byokError && (
                          <p className="text-xs text-red-600">{byokError}</p>
                        )}
                        {byokSuccess && (
                          <p className="text-xs text-emerald-600">
                            API key saved successfully!
                          </p>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => handleCheckout(plan.id)}
                        disabled={checkoutLoading !== null}
                        className={`w-full h-10 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                          plan.accent
                            ? 'bg-accent text-white enabled:hover:bg-accent/90 disabled:opacity-50'
                            : 'border border-stroke-subtle text-text-primary enabled:hover:bg-surface-subtle disabled:opacity-50'
                        }`}
                      >
                        {checkoutLoading === plan.id ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Redirecting...
                          </>
                        ) : (
                          <>
                            <CreditCard className="w-4 h-4" />
                            Subscribe to {plan.name}
                          </>
                        )}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {accessCodeAvailable && (
                <div className="mt-8 max-w-sm mx-auto">
                  <button
                    onClick={() => setAccessCodeOpen(!accessCodeOpen)}
                    className="flex items-center gap-1.5 text-sm text-text-tertiary enabled:hover:text-text-secondary transition-colors mx-auto"
                  >
                    Have an access code?
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${
                        accessCodeOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {accessCodeOpen && (
                    <div className="mt-3 flex gap-2">
                      <input
                        type="text"
                        placeholder="Enter access code"
                        value={accessCode}
                        onChange={(e) => {
                          setAccessCode(e.target.value);
                          setAccessCodeError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRedeemCode();
                        }}
                        className="flex-1 h-9 px-3 text-sm rounded-lg border border-stroke-subtle bg-surface-subtle text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none transition-colors"
                      />
                      <button
                        onClick={handleRedeemCode}
                        disabled={accessCodeLoading || !accessCode.trim()}
                        className="btn-primary !h-9 !px-4 !text-sm shrink-0"
                      >
                        {accessCodeLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          'Redeem'
                        )}
                      </button>
                    </div>
                  )}

                  {accessCodeError && (
                    <p className="mt-2 text-xs text-red-600 text-center">
                      {accessCodeError}
                    </p>
                  )}
                </div>
              )}

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
