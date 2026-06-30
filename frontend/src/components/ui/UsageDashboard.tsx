'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, type BillingUsageSummary } from '@/lib/api';
import { useBillingStore } from '@/stores/billingStore';

function formatPeriodDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

export function UsageDashboard() {
  const { tier, usedUsd, limitUsd, usagePercent } = useBillingStore();
  const [usage, setUsage] = useState<BillingUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getBillingUsage();
        if (!cancelled) setUsage(data);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load usage');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tier, usedUsd]);

  if (tier === 'byok' || tier === 'unlimited') {
    return (
      <div className="px-4 py-3 text-xs text-text-tertiary">
        {tier === 'byok'
          ? 'Usage is billed directly to your API key provider — no platform usage cap applies.'
          : 'Billing is not enabled on this deployment.'}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-4 py-6 flex justify-center text-text-tertiary">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  if (error) {
    return <div className="px-4 py-3 text-xs text-red-600">{error}</div>;
  }

  if (!usage) return null;

  const barColor =
    usagePercent >= 90 ? 'bg-red-500' : usagePercent >= 75 ? 'bg-amber-500' : 'bg-accent';
  const showWarning = limitUsd > 0 && usagePercent >= 80;

  return (
    <div className="px-4 py-3 space-y-4">
      {showWarning && (
        <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          You&apos;ve used {usagePercent.toFixed(0)}% of your included AI budget this period.
          Chat and analyses will stop when you hit the cap.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <div>
          <p className="text-text-tertiary">Period</p>
          <p className="text-text-primary font-medium">
            {formatPeriodDate(usage.period_start)}
            {usage.period_end ? ` – ${formatPeriodDate(usage.period_end)}` : ' – ongoing'}
          </p>
        </div>
        <div>
          <p className="text-text-tertiary">Tokens (period)</p>
          <p className="text-text-primary font-medium">
            {(usage.total_input_tokens ?? 0).toLocaleString()} in /{' '}
            {(usage.total_output_tokens ?? 0).toLocaleString()} out
          </p>
        </div>
      </div>

      {limitUsd > 0 && (
        <div>
          <div className="flex justify-between text-[10px] text-text-tertiary mb-1">
            <span>${usedUsd.toFixed(2)} used</span>
            <span>${limitUsd.toFixed(2)} cap</span>
          </div>
          <div className="h-2 rounded-full bg-surface-subtle overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${Math.min(100, usagePercent)}%` }}
            />
          </div>
        </div>
      )}

      {usage.by_model.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">
            By model
          </p>
          <div className="rounded-lg border border-stroke-subtle overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-surface-subtle/80 text-text-tertiary">
                <tr>
                  <th className="text-left font-medium px-2.5 py-1.5">Model</th>
                  <th className="text-right font-medium px-2.5 py-1.5">Calls</th>
                  <th className="text-right font-medium px-2.5 py-1.5">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stroke-subtle">
                {usage.by_model.map((row) => (
                  <tr key={row.model}>
                    <td className="px-2.5 py-1.5 text-text-primary truncate max-w-[140px]">
                      {row.model}
                    </td>
                    <td className="px-2.5 py-1.5 text-right text-text-secondary">
                      {row.call_count}
                    </td>
                    <td className="px-2.5 py-1.5 text-right text-text-primary">
                      ${row.estimated_cost_usd.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {usage.by_day.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">
            Daily spend
          </p>
          <div className="flex items-end gap-0.5 h-16">
            {usage.by_day.slice(-14).map((day) => {
              const max = Math.max(...usage.by_day.map((d) => d.estimated_cost_usd), 0.001);
              const height = Math.max(4, (day.estimated_cost_usd / max) * 100);
              return (
                <div
                  key={day.date}
                  className="flex-1 bg-accent/70 rounded-t-sm min-w-0"
                  style={{ height: `${height}%` }}
                  title={`${day.date}: $${day.estimated_cost_usd.toFixed(3)}`}
                />
              );
            })}
          </div>
          <p className="text-[10px] text-text-tertiary mt-1">Last {Math.min(14, usage.by_day.length)} days</p>
        </div>
      )}

      {usage.recent_calls.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">
            Recent calls
          </p>
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {usage.recent_calls.map((call, index) => (
              <div
                key={`${call.created_at}-${index}`}
                className="flex items-center justify-between gap-2 text-[10px] text-text-secondary"
              >
                <span className="truncate">{call.model}</span>
                <span className="shrink-0">${call.estimated_cost_usd.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
