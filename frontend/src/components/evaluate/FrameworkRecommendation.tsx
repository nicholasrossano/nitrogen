'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, Sparkles } from 'lucide-react';
import type { FrameworkInfo, FrameworkListItem } from '@/lib/api';

interface FrameworkRecommendationProps {
  framework: FrameworkInfo;
  allFrameworks?: FrameworkListItem[];
  onContinue: () => void;
  onSelectAlternative?: (frameworkId: string) => void;
}

const FAMILY_LABELS: Record<string, string> = {
  lender_dfi: 'Lender / DFI E&S',
  carbon_standard: 'Carbon Standard',
  site_diligence: 'Site Diligence',
};

export function FrameworkRecommendation({
  framework,
  allFrameworks,
  onContinue,
  onSelectAlternative,
}: FrameworkRecommendationProps) {
  const [showOther, setShowOther] = useState(false);

  const otherFrameworks = allFrameworks?.filter((f) => f.id !== framework.id) ?? [];
  const notActivated = framework.not_activated ?? [];

  return (
    <div className="space-y-5">
      {/* Recommended framework */}
      <div className="border border-accent/30 bg-accent-wash/30 rounded-lg px-5 py-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-4 h-4 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-text-primary">{framework.name}</h3>
              <span className="text-[10px] font-medium px-2 py-0.5 bg-accent/10 text-accent rounded-full">
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

        <button
          onClick={onContinue}
          className="btn-primary text-sm mt-1"
        >
          Continue with {framework.name}
        </button>
      </div>

      {/* Other supported standards (collapsed) */}
      {otherFrameworks.length > 0 && (
        <div>
          <button
            onClick={() => setShowOther((p) => !p)}
            className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
          >
            {showOther ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Other supported compliance standards
          </button>
          {showOther && (
            <div className="mt-2 space-y-1.5 ml-1">
              {otherFrameworks.map((f) => {
                const naEntry = notActivated.find((na) => na.id === f.id);
                return (
                  <div
                    key={f.id}
                    className="flex items-center justify-between gap-3 border border-divider rounded-lg px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-text-secondary">{f.name}</span>
                      {naEntry && (
                        <p className="text-[11px] text-text-tertiary mt-0.5">
                          Likely not relevant: {naEntry.reason}
                        </p>
                      )}
                    </div>
                    {onSelectAlternative && (
                      <button
                        onClick={() => onSelectAlternative(f.id)}
                        className="text-[11px] text-accent hover:underline whitespace-nowrap"
                      >
                        Use instead
                      </button>
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
