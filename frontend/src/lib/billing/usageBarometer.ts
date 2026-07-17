import type { BillingStatus } from '@/lib/api';

/** Reference denominator when no platform cap applies (BYOK / unlimited). Other nozzles can override later. */
export const DEFAULT_BAROMETER_DENOMINATOR_USD = 100;

export type BarometerTier = BillingStatus['tier'];

export interface BarometerScale {
  usedUsd: number;
  denominatorUsd: number;
  percent: number;
  isReferenceScale: boolean;
}

export function getBarometerScale(
  tier: BarometerTier | null | undefined,
  usedUsd: number,
  limitUsd: number,
): BarometerScale | null {
  if (limitUsd > 0) {
    return {
      usedUsd,
      denominatorUsd: limitUsd,
      percent: Math.min(100, (usedUsd / limitUsd) * 100),
      isReferenceScale: false,
    };
  }

  if (tier === 'byok' || tier === 'unlimited') {
    return {
      usedUsd,
      denominatorUsd: DEFAULT_BAROMETER_DENOMINATOR_USD,
      percent: Math.min(100, (usedUsd / DEFAULT_BAROMETER_DENOMINATOR_USD) * 100),
      isReferenceScale: true,
    };
  }

  return null;
}

export function barColorForPercent(percent: number): string {
  if (percent >= 90) return 'bg-red-500';
  if (percent >= 75) return 'bg-amber-500';
  return 'bg-accent';
}
