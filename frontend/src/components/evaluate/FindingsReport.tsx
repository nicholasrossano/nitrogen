'use client';

import { useState, useMemo } from 'react';
import { Clock, ChevronDown, ChevronRight, RefreshCw, Info } from 'lucide-react';
import type { CompliancePrecheck, ComplianceFinding } from '@/lib/api';
import { StatusBadge } from './StatusBadge';
import { FindingCard } from './FindingCard';
import { ReviewQueue } from './ReviewQueue';

interface FindingsReportProps {
  precheck: CompliancePrecheck;
  onRerun?: () => void;
  rerunning?: boolean;
}

export function FindingsReport({ precheck, onRerun, rerunning }: FindingsReportProps) {
  const [showWhySection, setShowWhySection] = useState(false);

  const groupedFindings = useMemo(() => {
    const groups: Record<string, ComplianceFinding[]> = {};
    for (const f of precheck.findings) {
      const key = f.section;
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    }
    return groups;
  }, [precheck.findings]);

  const { summary, framework } = precheck;
  const timestamp = new Date(precheck.generated_at).toLocaleString();

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">{framework.name}</h2>
              <div className="flex items-center gap-2 mt-1 text-xs text-text-secondary">
                <Clock className="w-3 h-3" />
                <span>{timestamp}</span>
                {precheck.version > 1 && (
                  <span className="text-text-tertiary">(v{precheck.version})</span>
                )}
              </div>
            </div>
            {onRerun && (
              <button
                onClick={onRerun}
                disabled={rerunning}
                className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${rerunning ? 'animate-spin' : ''}`} />
                Rerun
              </button>
            )}
          </div>

          {/* Summary pills */}
          <div className="flex flex-wrap gap-2">
            {summary.supported > 0 && (
              <SummaryPill label="Supported" count={summary.supported} className="bg-emerald-50 text-emerald-700 border-emerald-200" />
            )}
            {summary.partially_supported > 0 && (
              <SummaryPill label="Partial" count={summary.partially_supported} className="bg-amber-50 text-amber-700 border-amber-200" />
            )}
            {summary.missing > 0 && (
              <SummaryPill label="Missing" count={summary.missing} className="bg-red-50 text-red-700 border-red-200" />
            )}
            {summary.ambiguous > 0 && (
              <SummaryPill label="Ambiguous" count={summary.ambiguous} className="bg-orange-50 text-orange-700 border-orange-200" />
            )}
            {summary.not_enough_info > 0 && (
              <SummaryPill label="Not Enough Info" count={summary.not_enough_info} className="bg-gray-50 text-gray-600 border-gray-200" />
            )}
            {summary.human_review > 0 && (
              <SummaryPill label="Human Review" count={summary.human_review} className="bg-violet-50 text-violet-700 border-violet-200" />
            )}
            <SummaryPill label="Total" count={summary.total} className="bg-white text-text-primary border-divider" />
          </div>
        </div>

        {/* Delta (if rerun) */}
        {precheck.delta && precheck.delta.changed.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 space-y-1">
            <h4 className="text-xs font-semibold text-blue-800">Changes since last run</h4>
            {precheck.delta.newly_supported.length > 0 && (
              <p className="text-xs text-blue-700">
                {precheck.delta.newly_supported.length} newly supported
              </p>
            )}
            {precheck.delta.unresolved_blockers.length > 0 && (
              <p className="text-xs text-blue-700">
                {precheck.delta.unresolved_blockers.length} unresolved blockers
              </p>
            )}
            {precheck.delta.new_ambiguities.length > 0 && (
              <p className="text-xs text-blue-700">
                {precheck.delta.new_ambiguities.length} new ambiguities
              </p>
            )}
          </div>
        )}

        {/* Why This Was Run */}
        <div className="border border-divider rounded-lg overflow-hidden">
          <button
            onClick={() => setShowWhySection((p) => !p)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-black/[0.02] transition-colors"
          >
            <Info className="w-4 h-4 text-text-tertiary" />
            <span className="text-xs font-medium text-text-secondary">Why this framework was selected</span>
            <span className="ml-auto text-text-tertiary">
              {showWhySection ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </span>
          </button>
          {showWhySection && (
            <div className="px-4 pb-3 space-y-2 border-t border-divider pt-3">
              {framework.rationale && (
                <p className="text-sm text-text-primary">{framework.rationale}</p>
              )}
              {framework.signals.length > 0 && (
                <div>
                  <h5 className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-1">Signals</h5>
                  <div className="flex flex-wrap gap-1">
                    {framework.signals.map((sig, i) => (
                      <span key={i} className="text-[11px] px-2 py-0.5 bg-surface-subtle rounded-full text-text-secondary">
                        {sig}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {framework.not_activated.length > 0 && (
                <div>
                  <h5 className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-1">Not activated</h5>
                  <div className="space-y-0.5">
                    {framework.not_activated.map((na) => (
                      <p key={na.id} className="text-xs text-text-secondary">
                        <span className="font-medium">{na.id}</span>: {na.reason}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Findings by section */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-text-primary">Findings</h3>
          {Object.entries(groupedFindings).map(([section, findings]) => (
            <SectionGroup key={section} section={section} findings={findings} />
          ))}
        </div>

        {/* Review queue */}
        {precheck.review_queue.length > 0 && (
          <ReviewQueue items={precheck.review_queue} />
        )}

        <div className="pb-6" />
      </div>
    </div>
  );
}

function SectionGroup({ section, findings }: { section: string; findings: ComplianceFinding[] }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <button
        onClick={() => setCollapsed((p) => !p)}
        className="flex items-center gap-2 mb-2 group"
      >
        <span className="text-text-tertiary">
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
        <span className="text-xs font-semibold text-text-secondary group-hover:text-text-primary transition-colors">
          {section}
        </span>
        <span className="text-[10px] text-text-tertiary">({findings.length})</span>
      </button>
      {!collapsed && (
        <div className="space-y-2 ml-1">
          {findings.map((f) => (
            <FindingCard key={f.id} finding={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryPill({ label, count, className }: { label: string; count: number; className: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${className}`}>
      <span className="font-semibold">{count}</span>
      {label}
    </span>
  );
}
