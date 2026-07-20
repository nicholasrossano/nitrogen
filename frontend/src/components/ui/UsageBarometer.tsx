'use client';

import { useBillingStore } from '@/stores/billingStore';
import {
  barColorForPercent,
  barometerDisclaimer,
  getBarometerScale,
  type BarometerTier,
} from '@/lib/billing/usageBarometer';

interface UsageBarometerProps {
  tier?: BarometerTier | null;
  usedUsd?: number;
  limitUsd?: number;
  /** Sidebar pill: thinner bar, no dollar labels or reference note. */
  compact?: boolean;
  className?: string;
}

export function UsageBarometer({
  tier: tierProp,
  usedUsd: usedUsdProp,
  limitUsd: limitUsdProp,
  compact = false,
  className = '',
}: UsageBarometerProps) {
  const store = useBillingStore();
  const tier = tierProp ?? store.tier;
  const usedUsd = usedUsdProp ?? store.usedUsd;
  const limitUsd = limitUsdProp ?? store.limitUsd;

  const scale = getBarometerScale(tier, usedUsd, limitUsd);
  if (!scale) return null;

  const barColor = barColorForPercent(scale.percent);
  const barHeight = compact ? 'h-1' : 'h-1.5';
  const disclaimer = barometerDisclaimer(scale);

  if (compact) {
    return (
      <div className={`w-full px-1.5 ${className}`}>
        <div className={`${barHeight} rounded-full bg-surface-subtle overflow-hidden`}>
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${scale.percent}%` }}
          />
        </div>
        <div className="text-[9px] text-text-tertiary text-center mt-0.5 whitespace-nowrap">
          {Math.round(scale.percent)}% used
        </div>
      </div>
    );
  }

  const limitLabel =
    scale.scaleKind === 'reference'
      ? `$${scale.denominatorUsd.toFixed(2)}`
      : `$${scale.denominatorUsd.toFixed(2)} limit`;

  return (
    <div className={`px-4 py-3 space-y-1 ${className}`}>
      <div className="flex justify-between text-[10px] text-text-tertiary mb-1">
        <span>${scale.usedUsd.toFixed(2)} used</span>
        <span>{limitLabel}</span>
      </div>
      <div className={`${barHeight} rounded-full bg-surface-subtle overflow-hidden`}>
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${scale.percent}%` }}
        />
      </div>
      {disclaimer && (
        <p className="text-[10px] text-text-tertiary text-center pt-0.5">{disclaimer}</p>
      )}
    </div>
  );
}
