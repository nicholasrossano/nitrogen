'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Quote, AlertTriangle, User } from 'lucide-react';
import type { ComplianceFinding } from '@/lib/api';
import { StatusBadge } from './StatusBadge';

interface FindingCardProps {
  finding: ComplianceFinding;
}

export function FindingCard({ finding }: FindingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hasEvidence = finding.evidence.length > 0;
  const hasMissing = !!finding.missing_support;

  return (
    <div className="border border-divider rounded-lg bg-white overflow-hidden">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left enabled:hover:bg-black/[0.02] transition-colors"
      >
        <span className="mt-0.5 text-text-tertiary flex-shrink-0">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-text-primary">{finding.requirement_name}</span>
            <StatusBadge status={finding.status} />
            {finding.human_review_needed && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-violet-600">
                <User className="w-3 h-3" />
                Review needed
              </span>
            )}
          </div>
          <p className="text-xs text-text-secondary mt-0.5 line-clamp-1">{finding.section}</p>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-0 space-y-3 border-t border-divider">
          <div className="pt-3">
            <p className="text-sm text-text-primary leading-relaxed">{finding.rationale}</p>
          </div>

          {hasEvidence && (
            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-1.5">
                Evidence
              </h4>
              <div className="space-y-1.5">
                {finding.evidence.map((ev, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs bg-surface-subtle rounded px-2.5 py-2">
                    <Quote className="w-3 h-3 text-text-tertiary flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <span className="font-medium text-text-primary">{ev.source_title}</span>
                      {ev.quote && (
                        <p className="text-text-secondary mt-0.5 italic">&ldquo;{ev.quote}&rdquo;</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasMissing && (
            <div className="flex items-start gap-2 text-xs bg-amber-50 rounded px-2.5 py-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-medium text-amber-800">Missing or weak support</span>
                <p className="text-amber-700 mt-0.5">{finding.missing_support}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
