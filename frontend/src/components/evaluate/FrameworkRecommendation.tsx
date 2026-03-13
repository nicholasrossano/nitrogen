'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, Sparkles, Clock } from 'lucide-react';
import type { FrameworkInfo, FrameworkListItem, CompliancePrecheck } from '@/lib/api';

function getPrecheckStatus(check: CompliancePrecheck): { label: string; color: string } {
  const s = check.summary;
  const incomplete = (s?.missing ?? 0) + (s?.ambiguous ?? 0) + (s?.not_enough_info ?? 0) + (s?.human_review ?? 0);
  return incomplete === 0
    ? { label: 'Completed', color: 'text-green-600' }
    : { label: 'In Progress', color: 'text-amber-600' };
}

interface FrameworkRecommendationProps {
  framework: FrameworkInfo;
  allFrameworks?: FrameworkListItem[];
  savedPrechecks?: Record<string, CompliancePrecheck>;
  onContinue: () => void;
  onSelectAlternative?: (frameworkId: string) => void;
  onViewReport?: (frameworkId: string) => void;
}

const FAMILY_LABELS: Record<string, string> = {
  lender_dfi: 'Lender / DFI E&S',
  carbon_standard: 'Carbon Standard',
  site_diligence: 'Site Diligence',
};

export function FrameworkRecommendation({
  framework,
  allFrameworks,
  savedPrechecks = {},
  onContinue,
  onSelectAlternative,
  onViewReport,
}: FrameworkRecommendationProps) {
  const [showNotRelevant, setShowNotRelevant] = useState(false);

  const possiblyRelevant = framework.possibly_relevant ?? [];
  const notActivated = framework.not_activated ?? [];

  const possiblyRelevantItems = possiblyRelevant
    .map((pr) => {
      const meta = allFrameworks?.find((f) => f.id === pr.id);
      return meta ? { ...meta, reason: pr.reason } : null;
    })
    .filter(Boolean) as (FrameworkListItem & { reason: string })[];

  const notActivatedItems = notActivated
    .map((na) => {
      const meta = allFrameworks?.find((f) => f.id === na.id);
      return meta ? { ...meta, reason: na.reason } : null;
    })
    .filter(Boolean) as (FrameworkListItem & { reason: string })[];

  const recommendedSaved = savedPrechecks[framework.id];

  return (
    <div className="space-y-5">
      {/* ── Recommended framework ─────────────────────────────────── */}
      <div className="border border-accent/30 bg-accent-wash/30 rounded-lg overflow-hidden">
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold text-text-primary">{framework.name}</h3>
                <span className="text-[10px] font-medium px-1.5 py-0.5 bg-accent/10 text-accent rounded">
                  {FAMILY_LABELS[framework.family] ?? framework.family}
                </span>
              </div>
              <p className="text-sm text-text-secondary mt-1.5 leading-relaxed">{framework.rationale}</p>
            </div>
          </div>

          {framework.signals.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-1.5">
                Detected signals
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {framework.signals.map((sig, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-white/60 border border-accent/20 rounded-full text-text-secondary"
                  >
                    <CheckCircle2 className="w-3 h-3 text-accent" />
                    {sig}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-surface-subtle/50 border-t border-accent/20 flex items-center justify-between">
          {recommendedSaved ? (
            <>
              <div className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
                <CheckCircle2 className={`w-3 h-3 ${getPrecheckStatus(recommendedSaved).color}`} />
                <span className={getPrecheckStatus(recommendedSaved).color}>{getPrecheckStatus(recommendedSaved).label}</span>
                <span className="text-text-tertiary">v{recommendedSaved.version ?? 1}</span>
                <span className="mx-0.5">·</span>
                <Clock className="w-2.5 h-2.5" />
                <span>{new Date(recommendedSaved.generated_at).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-2">
                {onViewReport && (
                  <button
                    onClick={() => onViewReport(framework.id)}
                    className="btn-secondary !text-xs !px-3 !py-1"
                  >
                    View Report
                  </button>
                )}
                <button
                  onClick={onContinue}
                  className="btn-primary !text-xs !px-4 !py-1.5"
                >
                  Rerun with {framework.name}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[10px] text-text-tertiary">
                Review scope facts before running the analysis
              </p>
              <button
                onClick={onContinue}
                className="btn-primary !text-xs !px-4 !py-1.5"
              >
                Continue with {framework.name}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Possibly relevant ──────────────────────────────────────── */}
      {possiblyRelevantItems.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-0.5">
            Possibly Relevant
          </h4>
          {possiblyRelevantItems.map((f) => {
            const saved = savedPrechecks[f.id];
            return (
              <div key={f.id} className="border border-divider rounded-lg overflow-hidden">
                <div className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <span className="text-sm font-medium text-text-secondary">{f.name}</span>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 shrink-0">
                      Possibly relevant
                    </span>
                  </div>
                  <p className="text-[11px] text-text-tertiary leading-relaxed">{f.reason}</p>
                </div>
                <div className="px-4 py-2 border-t border-divider flex items-center justify-between">
                  {saved ? (
                    <>
                      <div className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
                        <CheckCircle2 className={`w-3 h-3 ${getPrecheckStatus(saved).color}`} />
                        <span className={getPrecheckStatus(saved).color}>{getPrecheckStatus(saved).label}</span>
                        <span>v{saved.version ?? 1}</span>
                        <span className="mx-0.5">·</span>
                        <Clock className="w-2.5 h-2.5" />
                        <span>{new Date(saved.generated_at).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {onViewReport && (
                          <button
                            onClick={() => onViewReport(f.id)}
                            className="btn-secondary !text-xs !px-3 !py-1"
                          >
                            View Report
                          </button>
                        )}
                        {onSelectAlternative && (
                          <button
                            onClick={() => onSelectAlternative(f.id)}
                            className="btn-primary !text-xs !px-3 !py-1"
                          >
                            Rerun
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <span />
                      {onSelectAlternative && (
                        <button
                          onClick={() => onSelectAlternative(f.id)}
                          className="btn-primary !text-xs !px-3 !py-1"
                        >
                          Use instead
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Other (collapsed) ─────────────────────────────────────── */}
      {notActivatedItems.length > 0 && (
        <div>
          <button
            onClick={() => setShowNotRelevant((p) => !p)}
            className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary hover:text-text-secondary transition-colors px-0.5"
          >
            {showNotRelevant ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Other
          </button>
          {showNotRelevant && (
            <div className="mt-2 space-y-1.5">
              {[...notActivatedItems].sort((a, b) => {
                const aInProgress = savedPrechecks[a.id] && getPrecheckStatus(savedPrechecks[a.id]).label === 'In Progress';
                const bInProgress = savedPrechecks[b.id] && getPrecheckStatus(savedPrechecks[b.id]).label === 'In Progress';
                return aInProgress === bInProgress ? 0 : aInProgress ? -1 : 1;
              }).map((f) => {
                const saved = savedPrechecks[f.id];
                return (
                  <div key={f.id} className="border border-divider rounded-lg overflow-hidden">
                    <div className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3 mb-1">
                        <span className="text-sm font-medium text-text-secondary">{f.name}</span>
                        {saved ? (
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${
                            getPrecheckStatus(saved).label === 'Completed'
                              ? 'bg-green-50 text-green-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}>
                            {getPrecheckStatus(saved).label}
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">
                            Likely not relevant
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-text-tertiary leading-relaxed">{f.reason}</p>
                    </div>
                    {saved && onViewReport && (
                      <div className="px-4 py-2 border-t border-divider flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
                          <CheckCircle2 className="w-3 h-3 text-green-600" />
                          <span>v{saved.version ?? 1}</span>
                          <span className="mx-0.5">·</span>
                          <Clock className="w-2.5 h-2.5" />
                          <span>{new Date(saved.generated_at).toLocaleDateString()}</span>
                        </div>
                        <button
                          onClick={() => onViewReport(f.id)}
                          className="btn-secondary !text-xs !px-3 !py-1"
                        >
                          View Report
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
