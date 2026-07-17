import type { BillingStatus } from '@/lib/api';

/** Reference denominator when no platform cap applies (BYOK / unlimited). Other nozzles can override later. */
export const DEFAULT_BAROMETER_DENOMINATOR_USD = 100;

export const REFERENCE_SCALE_DISCLAIMER =
  'Scale defaults to $100. No platform usage cap applies.';

export const SUBSCRIPTION_CAP_DISCLAIMER =
  'Usage cap is 95% of subscription price to manage platform costs and account for potential overages.';

export type BarometerTier = BillingStatus['tier'];

export type BarometerScaleKind = 'subscription' | 'reference' | 'trial';

export interface BarometerScale {
  usedUsd: number;
  denominatorUsd: number;
  percent: number;
  scaleKind: BarometerScaleKind;
}

const SUBSCRIPTION_PLAN_TIERS = new Set<BarometerTier>(['individual', 'starter', 'pro']);

export function isSubscriptionPlanTier(tier: BarometerTier | null | undefined): boolean {
  return tier != null && SUBSCRIPTION_PLAN_TIERS.has(tier);
}

export function getBarometerScale(
  tier: BarometerTier | null | undefined,
  usedUsd: number,
  limitUsd: number,
): BarometerScale | null {
  if (isSubscriptionPlanTier(tier) && limitUsd > 0) {
    return {
      usedUsd,
      denominatorUsd: limitUsd,
      percent: Math.min(100, (usedUsd / limitUsd) * 100),
      scaleKind: 'subscription',
    };
  }

  if (tier === 'byok' || tier === 'unlimited') {
    return {
      usedUsd,
      denominatorUsd: DEFAULT_BAROMETER_DENOMINATOR_USD,
      percent: Math.min(100, (usedUsd / DEFAULT_BAROMETER_DENOMINATOR_USD) * 100),
      scaleKind: 'reference',
    };
  }

  if (tier === 'trial' && limitUsd > 0) {
    return {
      usedUsd,
      denominatorUsd: limitUsd,
      percent: Math.min(100, (usedUsd / limitUsd) * 100),
      scaleKind: 'trial',
    };
  }

  return null;
}

export function barColorForPercent(percent: number): string {
  if (percent >= 90) return 'bg-red-500';
  if (percent >= 75) return 'bg-amber-500';
  return 'bg-accent';
}

export function barometerDisclaimer(scale: BarometerScale): string | null {
  if (scale.scaleKind === 'subscription') return SUBSCRIPTION_CAP_DISCLAIMER;
  if (scale.scaleKind === 'reference') return REFERENCE_SCALE_DISCLAIMER;
  return null;
}
