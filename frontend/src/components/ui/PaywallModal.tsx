'use client';

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useBillingStore } from '@/stores/billingStore';
import { BillingOptionsPanel } from '@/components/ui/BillingOptionsPanel';

function getHeading(tier: string | null, status: string): string {
  if (tier === 'trial') return 'Your free trial has ended';
  if (tier === 'starter' || tier === 'pro') return "You've reached your monthly limit";
  return 'Choose a plan to continue';
}

export function PaywallModal() {
  const {
    showPaywall,
    tier,
    status,
    dismissPaywall,
    triggerPaywall,
  } = useBillingStore();

  const [visible, setVisible] = useState(false);

  // Listen for the global paywall event
  useEffect(() => {
    const handler = () => triggerPaywall();
    window.addEventListener('nitrogen:paywall', handler);
    return () => window.removeEventListener('nitrogen:paywall', handler);
  }, [triggerPaywall]);

  // Animate in when showPaywall becomes true
  useEffect(() => {
    if (showPaywall) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [showPaywall]);

  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(() => dismissPaywall(), 150);
  }, [dismissPaywall]);

  if (!showPaywall) return null;

  const modal = (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-150 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="relative w-full max-w-2xl mx-4 rounded-2xl bg-white shadow-2xl border border-stroke-subtle flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <h2 className="text-base font-semibold text-text-primary">
            {getHeading(tier, status)}
          </h2>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-subtle transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pb-6 overflow-y-auto flex-1 min-h-0 space-y-5">
          <BillingOptionsPanel onByokSaved={handleClose} />
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
