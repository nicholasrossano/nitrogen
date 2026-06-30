'use client';

import { useEffect, useState } from 'react';
import { Sparkles, Key, ChevronDown, Check, Loader2, Trash2 } from 'lucide-react';
import { useBillingStore } from '@/stores/billingStore';
import { api } from '@/lib/api';

const SUBSCRIPTION_PRICE_ID = process.env.NEXT_PUBLIC_STRIPE_PRICE_ID ?? '';
const SUBSCRIPTION_PRICE_LABEL = process.env.NEXT_PUBLIC_SUBSCRIPTION_PRICE_LABEL ?? '$20';
const SUBSCRIPTION_USAGE_CAP_LABEL =
  process.env.NEXT_PUBLIC_SUBSCRIPTION_USAGE_CAP_LABEL ?? '$20';

type ByokProvider = 'openai' | 'openrouter';

const BYOK_PROVIDERS: { id: ByokProvider; label: string; placeholder: string; hint: string }[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    placeholder: 'sk-...',
    hint: 'Direct OpenAI API key (chat, analyses, embeddings).',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    placeholder: 'sk-or-...',
    hint: 'OpenRouter key — OpenAI-compatible models and embeddings.',
  },
];

interface BillingOptionsPanelProps {
  onByokSaved?: () => void;
}

export function BillingOptionsPanel({ onByokSaved }: BillingOptionsPanelProps) {
  const { accessCodeAvailable, redeemAccessCode, fetchBillingStatus } = useBillingStore();
  const [apiKeys, setApiKeys] = useState<Record<ByokProvider, string>>({ openai: '', openrouter: '' });
  const [savedProviders, setSavedProviders] = useState<Set<ByokProvider>>(new Set());
  const [accessCode, setAccessCode] = useState('');
  const [accessCodeOpen, setAccessCodeOpen] = useState(false);
  const [savingProvider, setSavingProvider] = useState<ByokProvider | null>(null);
  const [deletingProvider, setDeletingProvider] = useState<ByokProvider | null>(null);
  const [redeemingCode, setRedeemingCode] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<ByokProvider | null>(null);

  const loadStoredKeys = async () => {
    try {
      const keys = await api.listApiKeys();
      const providers = new Set(
        keys
          .map((k) => k.provider)
          .filter((p): p is ByokProvider => p === 'openai' || p === 'openrouter'),
      );
      setSavedProviders(providers);
    } catch {
      // non-fatal
    }
  };

  useEffect(() => {
    void loadStoredKeys();
  }, []);

  const handleCheckout = async () => {
    if (!SUBSCRIPTION_PRICE_ID) {
      setError('Subscription is not configured on this deployment.');
      return;
    }
    setError(null);
    setCheckoutLoading(true);
    try {
      const { url } = await api.createCheckout(
        SUBSCRIPTION_PRICE_ID,
        `${window.location.origin}/subscribe?success=true`,
        `${window.location.origin}/subscribe?canceled=true`,
      );
      window.location.href = url;
    } catch {
      setError('Could not start checkout. Please try again.');
      setCheckoutLoading(false);
    }
  };

  const handleSaveKey = async (provider: ByokProvider) => {
    const apiKey = apiKeys[provider].trim();
    if (!apiKey) return;
    setError(null);
    setSavingProvider(provider);
    try {
      await api.storeApiKey(apiKey, provider);
      await fetchBillingStatus();
      await loadStoredKeys();
      setSavedFlash(provider);
      setApiKeys((prev) => ({ ...prev, [provider]: '' }));
      setTimeout(() => {
        setSavedFlash(null);
        onByokSaved?.();
      }, 600);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save API key.');
    } finally {
      setSavingProvider(null);
    }
  };

  const handleDeleteKey = async (provider: ByokProvider) => {
    setError(null);
    setDeletingProvider(provider);
    try {
      await api.deleteApiKey(provider);
      await fetchBillingStatus();
      await loadStoredKeys();
      setSavedProviders((prev) => {
        const next = new Set(prev);
        next.delete(provider);
        return next;
      });
    } catch {
      setError('Could not remove API key.');
    } finally {
      setDeletingProvider(null);
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-accent/40 ring-1 ring-accent/20 p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-lg bg-accent/10 text-accent flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <span className="text-sm font-semibold text-text-primary">Individual</span>
          </div>
          <p className="text-xs text-text-tertiary mb-1">Flat subscription with included AI usage</p>
          <p className="text-lg font-semibold text-text-primary mb-1">
            {SUBSCRIPTION_PRICE_LABEL}
            <span className="text-xs font-normal text-text-tertiary">/mo</span>
          </p>
          <p className="text-[11px] text-text-tertiary mb-3">
            Includes up to {SUBSCRIPTION_USAGE_CAP_LABEL} of platform AI usage per billing period.
          </p>
          <button
            onClick={handleCheckout}
            disabled={checkoutLoading || !SUBSCRIPTION_PRICE_ID}
            className="mt-auto w-full text-xs font-medium rounded-lg px-3 py-2 bg-accent text-white enabled:hover:bg-accent/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
          >
            {checkoutLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Subscribe
          </button>
        </div>

        <div className="rounded-xl border border-stroke-subtle p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-lg bg-surface-subtle flex items-center justify-center">
              <Key className="w-4 h-4 text-text-secondary" />
            </div>
            <span className="text-sm font-semibold text-text-primary">Bring your own key</span>
          </div>
          <p className="text-xs text-text-tertiary mb-3">
            Use your OpenAI or OpenRouter API key. Unlimited usage on your account — no subscription required.
          </p>
          <div className="space-y-3 mt-auto">
            {BYOK_PROVIDERS.map((provider) => {
              const isSaved = savedProviders.has(provider.id);
              return (
                <div key={provider.id} className="rounded-lg border border-stroke-subtle p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-text-primary">{provider.label}</span>
                    {isSaved && (
                      <button
                        type="button"
                        onClick={() => handleDeleteKey(provider.id)}
                        disabled={deletingProvider === provider.id}
                        className="text-[10px] text-text-tertiary hover:text-red-600 flex items-center gap-0.5 disabled:opacity-50"
                      >
                        {deletingProvider === provider.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                        Remove
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-text-tertiary leading-snug">{provider.hint}</p>
                  {!isSaved ? (
                    <>
                      <input
                        type="password"
                        placeholder={provider.placeholder}
                        value={apiKeys[provider.id]}
                        onChange={(e) =>
                          setApiKeys((prev) => ({ ...prev, [provider.id]: e.target.value }))
                        }
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveKey(provider.id)}
                        className="w-full text-xs rounded-lg border border-stroke-subtle px-3 py-2 text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <button
                        onClick={() => handleSaveKey(provider.id)}
                        disabled={!apiKeys[provider.id].trim() || savingProvider === provider.id}
                        className="w-full text-xs font-medium rounded-lg px-3 py-2 bg-surface-subtle text-text-primary enabled:hover:bg-surface-subtle/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
                      >
                        {savingProvider === provider.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : savedFlash === provider.id ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            Saved
                          </>
                        ) : (
                          `Save ${provider.label} key`
                        )}
                      </button>
                    </>
                  ) : (
                    <p className="text-[11px] text-green-700 bg-green-50 border border-green-200 rounded-lg px-2.5 py-1.5">
                      Key saved — AI usage bills to your {provider.label} account.
                    </p>
                  )}
                </div>
              );
            })}
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
