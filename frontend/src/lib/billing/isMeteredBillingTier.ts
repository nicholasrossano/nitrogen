import type { BillingStatus } from '@/lib/api/types';

/** Tiers that mean Stripe/BYOK billing is active (not self-host unlimited). */
export function isMeteredBillingTier(tier: BillingStatus['tier'] | null | undefined): boolean {
  return (
    tier === 'trial' ||
    tier === 'individual' ||
    tier === 'starter' ||
    tier === 'pro' ||
    tier === 'byok'
  );
}
