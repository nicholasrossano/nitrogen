'use client';

import { useBillingStore } from '@/stores/billingStore';
import { useDemoMode } from '@/hooks/useDemoMode';

/** Trial remaining count — sits under the chat composer, not in the side nav. */
export function ChatTrialHint() {
  const { isDemo } = useDemoMode();
  const { tier, trialMessagesRemaining, loaded } = useBillingStore();

  if (isDemo || !loaded || tier !== 'trial' || trialMessagesRemaining == null) {
    return null;
  }

  return (
    <p className="mt-2 text-center text-[11px] text-text-tertiary">
      {trialMessagesRemaining} free msg{trialMessagesRemaining !== 1 ? 's' : ''} left
    </p>
  );
}
