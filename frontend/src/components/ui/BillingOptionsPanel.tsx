'use client';

import { useState } from 'react';
import { Sparkles, Zap, Key, ChevronDown, Check, Loader2 } from 'lucide-react';
import { useBillingStore } from '@/stores/billingStore';
import { api } from '@/lib/api';

const STARTER_PRICE_ID = process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID ?? '';
const PRO_PRICE_ID = process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID ?? '';

interface BillingOptionsPanelProps {
  onByokSaved?: () => void;
}

export function BillingOptionsPanel({ onByokSaved }: BillingOptionsPanelProps) {
  const { accessCodeAvailable, redeemAccessCode, fetchBillingStatus } = useBillingStore();
  const [apiKey, setApiKey] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [accessCodeOpen, setAccessCodeOpen] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [redeemingCode, setRedeemingCode] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keySaved, setKeySaved] = useState(false);

  const handleCheckout = async (priceId: string) => {
    setError(null);
    setCheckoutLoading(priceId);
    try {
      const { url } = await api.createCheckout(
        priceId,
        `${window.location.origin}/subscribe?success=true`,
        `${window.location.origin}/subscribe?canceled=true`,
      );
      window.location.href = url;
    } catch {
      setError('Could not start checkout. Please try again.');
      setCheckoutLoading(null);
    }
  };

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;
    setError(null);
    setSavingKey(true);
    try {
      await api.storeApiKey(apiKey.trim());
      await fetchBillingStatus();
      setKeySaved(true);
      setTimeout(() => {
        setApiKey('');
        setKeySaved(false);
        onByokSaved?.();
      }, 600);
    } catch {
      setError('Could not save API key. Please check and try again.');
    } finally {
      setSavingKey(false);
    }
  };

  const handleRedeem = async () => {
    if (!accessCode.trim()) return;
    setError(null);
    setRedeemingCode(true);
    const result = await redeemAccessCode(accessCode.trim());
    if (!result.success) {
      setError(result.error || 'Invalid access code.');
    } else {
      setAccessCode('');
    }
    setRedeemingCode(false);
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <PlanCard
          icon={<Sparkles className="w-4 h-4" />}
          name="Starter"
          price="$1"
          period="/mo"
          description="For getting started"
          buttonLabel="Subscribe"
          loading={checkoutLoading === STARTER_PRICE_ID}
          disabled={!!checkoutLoading}
          onAction={() => handleCheckout(STARTER_PRICE_ID)}
        />

        <PlanCard
          icon={<Zap className="w-4 h-4" />}
          name="Pro"
          price="$2"
          period="/mo"
          description="For power users"
          buttonLabel="Subscribe"
          loading={checkoutLoading === PRO_PRICE_ID}
          disabled={!!checkoutLoading}
          highlighted
          onAction={() => handleCheckout(PRO_PRICE_ID)}
        />

        <div className="rounded-xl border border-stroke-subtle p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-lg bg-surface-subtle flex items-center justify-center">
              <Key className="w-4 h-4 text-text-secondary" />
            </div>
            <span className="text-sm font-semibold text-text-primary">BYOK</span>
          </div>
          <p className="text-xs text-text-tertiary mb-1">Bring your own API key</p>
          <p className="text-lg font-semibold text-text-primary mb-3">
            Free
          </p>
          <div className="mt-auto space-y-2">
            <input
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
              className="w-full text-xs rounded-lg border border-stroke-subtle px-3 py-2 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              onClick={handleSaveKey}
              disabled={!apiKey.trim() || savingKey}
              className="w-full text-xs font-medium rounded-lg px-3 py-2 bg-surface-subtle text-text-primary enabled:hover:bg-surface-subtle/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
            >
              {savingKey ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : keySaved ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Saved
                </>
              ) : (
                'Use my key'
              )}
            </button>
          </div>
        </div>
      </div>

      {accessCodeAvailable && (
        <div className="border-t border-stroke-subtle pt-4">
          <button
            onClick={() => setAccessCodeOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-150 ${
                accessCodeOpen ? 'rotate-0' : '-rotate-90'
              }`}
            />
            Have an access code?
          </button>
          {accessCodeOpen && (
            <div className="flex items-center gap-2 mt-2.5">
              <input
                type="text"
                placeholder="Enter code"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRedeem()}
                className="flex-1 text-xs rounded-lg border border-stroke-subtle px-3 py-2 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                onClick={handleRedeem}
                disabled={!accessCode.trim() || redeemingCode}
                className="text-xs font-medium rounded-lg px-4 py-2 bg-accent text-white enabled:hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
              >
                {redeemingCode && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Redeem
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlanCard({
  icon,
  name,
  price,
  period,
  description,
  buttonLabel,
  loading,
  disabled,
  highlighted,
  onAction,
}: {
  icon: React.ReactNode;
  name: string;
  price: string;
  period: string;
  description: string;
  buttonLabel: string;
  loading: boolean;
  disabled: boolean;
  highlighted?: boolean;
  onAction: () => void;
}) {
  return (
    <div
      className={`rounded-xl border p-4 flex flex-col ${
        highlighted
          ? 'border-accent/40 ring-1 ring-accent/20'
          : 'border-stroke-subtle'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <div
          className={`w-7 h-7 rounded-lg flex items-center justify-center ${
            highlighted ? 'bg-accent/10 text-accent' : 'bg-surface-subtle text-text-secondary'
          }`}
        >
          {icon}
        </div>
        <span className="text-sm font-semibold text-text-primary">{name}</span>
      </div>
      <p className="text-xs text-text-tertiary mb-1">{description}</p>
      <p className="text-lg font-semibold text-text-primary mb-3">
        {price}
        <span className="text-xs font-normal text-text-tertiary">{period}</span>
      </p>
      <button
        onClick={onAction}
        disabled={disabled}
        className={`mt-auto w-full text-xs font-medium rounded-lg px-3 py-2 transition-colors flex items-center justify-center gap-1.5 disabled:cursor-not-allowed ${
          highlighted
            ? 'bg-accent text-white enabled:hover:bg-accent/90 disabled:opacity-60'
            : 'bg-surface-subtle text-text-primary enabled:hover:bg-surface-subtle/80 disabled:opacity-50'
        }`}
      >
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {buttonLabel}
      </button>
    </div>
  );
}
