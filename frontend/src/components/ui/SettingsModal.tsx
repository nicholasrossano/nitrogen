'use client';

import { useEffect, useState } from 'react';
import { X, FlaskConical, CreditCard, Loader2, ExternalLink } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useSettingsStore } from '@/stores/settingsStore';
import { useBillingStore } from '@/stores/billingStore';
import { api } from '@/lib/api';

interface SettingsModalProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// SettingsModal
// ---------------------------------------------------------------------------
// Sectioned layout — add new sections by appending <SettingsSection> blocks.
// Each toggle/input should read from and write to useSettingsStore.
// ---------------------------------------------------------------------------

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-1 pb-1">
        {title}
      </p>
      <div className="rounded-xl border border-stroke-subtle divide-y divide-stroke-subtle overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function SettingsRow({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 px-4 py-3 hover:bg-surface-subtle/60 cursor-pointer select-none">
      {Icon && (
        <div className="w-7 h-7 rounded-lg bg-surface-subtle flex items-center justify-center flex-shrink-0">
          <Icon className="w-3.5 h-3.5 text-text-secondary" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        {description && (
          <p className="text-xs text-text-tertiary mt-0.5 leading-snug">{description}</p>
        )}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
          checked ? 'bg-accent' : 'bg-surface-subtle border border-stroke-subtle'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  );
}

const TIER_LABELS: Record<string, string> = {
  trial: 'Free Trial',
  starter: 'Starter',
  pro: 'Pro',
  byok: 'BYOK',
  none: 'No Plan',
  unlimited: 'Unlimited',
};

function PlanBillingSection({ onOpenPaywall }: { onOpenPaywall: () => void }) {
  const { tier, usedUsd, limitUsd, usagePercent, trialMessagesRemaining, accessCodeAvailable, accessCodeRedeemed, loaded } = useBillingStore();
  const redeemAccessCode = useBillingStore((s) => s.redeemAccessCode);

  const [portalLoading, setPortalLoading] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState('');
  const [showCodeInput, setShowCodeInput] = useState(false);

  if (!loaded) return null;

  const isStripeManagedTier = tier === 'starter' || tier === 'pro';

  const handleManageSubscription = async () => {
    if (!isStripeManagedTier) {
      onOpenPaywall();
      return;
    }
    setPortalLoading(true);
    try {
      const { url } = await api.createPortalSession(window.location.href);
      window.location.href = url;
    } catch {
      setPortalLoading(false);
    }
  };

  const handleRedeemCode = async () => {
    if (!codeInput.trim()) return;
    setCodeLoading(true);
    setCodeError('');
    const result = await redeemAccessCode(codeInput.trim());
    if (!result.success) setCodeError(result.error || 'Invalid code');
    setCodeLoading(false);
  };

  const barColor = usagePercent >= 90 ? 'bg-red-500' : usagePercent >= 75 ? 'bg-amber-500' : 'bg-accent';

  return (
    <>
      <SettingsSection title="Plan & Billing">
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">{TIER_LABELS[tier ?? 'none'] ?? tier}</span>
              {tier === 'trial' && trialMessagesRemaining != null && (
                <span className="text-[10px] font-medium bg-surface-subtle text-text-secondary px-1.5 py-0.5 rounded-full">
                  {trialMessagesRemaining} msgs left
                </span>
              )}
            </div>
            <button
              onClick={handleManageSubscription}
              disabled={isStripeManagedTier && portalLoading}
              className="text-[11px] text-accent enabled:hover:underline disabled:opacity-50 flex items-center gap-1"
            >
              {isStripeManagedTier ? (
                portalLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />
              ) : (
                <CreditCard className="w-3 h-3" />
              )}
              Manage
            </button>
          </div>

          {limitUsd > 0 && (
            <div>
              <div className="flex justify-between text-[10px] text-text-tertiary mb-1">
                <span>${usedUsd.toFixed(2)} used</span>
                <span>${limitUsd.toFixed(2)} limit</span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-subtle overflow-hidden">
                <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, usagePercent)}%` }} />
              </div>
            </div>
          )}

          {tier === 'trial' && accessCodeAvailable && !accessCodeRedeemed && (
            <div>
              {!showCodeInput ? (
                <button onClick={() => setShowCodeInput(true)} className="text-[11px] text-accent hover:underline">
                  Have an access code?
                </button>
              ) : (
                <div className="flex gap-1.5">
                  <input
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    placeholder="Enter code"
                    className="flex-1 text-xs px-2 py-1 rounded-lg border border-stroke-subtle bg-white focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    onClick={handleRedeemCode}
                    disabled={codeLoading || !codeInput.trim()}
                    className="text-[11px] px-2 py-1 bg-accent text-white rounded-lg enabled:hover:bg-accent/90 disabled:opacity-50"
                  >
                    {codeLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Redeem'}
                  </button>
                </div>
              )}
              {codeError && <p className="text-[10px] text-red-500 mt-1">{codeError}</p>}
            </div>
          )}
        </div>
      </SettingsSection>
    </>
  );
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [visible, setVisible] = useState(false);
  const { devMode, setDevMode } = useSettingsStore();
  const triggerPaywall = useBillingStore((s) => s.triggerPaywall);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 150);
  };

  const handleOpenPaywallFromSettings = () => {
    handleClose();
    setTimeout(() => triggerPaywall({ source: 'settings_manage' }), 160);
  };

  const modal = (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-150 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="relative w-full max-w-sm mx-4 rounded-2xl bg-white shadow-2xl border border-stroke-subtle flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-stroke-subtle flex-shrink-0">
          <h2 className="text-sm font-semibold text-text-primary">Settings</h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — add new <SettingsSection> blocks here */}
        <div className="px-5 py-4 space-y-5 overflow-y-auto flex-1 min-h-0">
          {devMode && <PlanBillingSection onOpenPaywall={handleOpenPaywallFromSettings} />}

          <SettingsSection title="Developer">
            <SettingsRow
              icon={FlaskConical}
              label="Developer Mode"
              description="Enables billing, usage tracking, and other features under development."
              checked={devMode}
              onChange={setDevMode}
            />
          </SettingsSection>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
