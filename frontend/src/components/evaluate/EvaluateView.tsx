'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlaskConical, AlertTriangle, CheckCircle2, Clock, ArrowLeft } from 'lucide-react';
import { PageLoader } from '@/components/ui/PageLoader';
import { useInitiativeStore } from '@/stores/initiativeStore';
import type { FrameworkRoutingResult, FrameworkInfo, ScopeFact, FrameworkListItem, CompliancePrecheck } from '@/lib/api';
import { api } from '@/lib/api';
import { FrameworkRecommendation } from './FrameworkRecommendation';
import { ScopeConfirmation } from './ScopeConfirmation';
import { FindingsReport } from './FindingsReport';

type Stage = 'idle' | 'routing' | 'recommendation' | 'scope' | 'running' | 'results';

function getPrecheckStatus(check: CompliancePrecheck): { label: string; color: string } {
  const s = check.summary;
  const incomplete = (s?.missing ?? 0) + (s?.ambiguous ?? 0) + (s?.not_enough_info ?? 0) + (s?.human_review ?? 0);
  return incomplete === 0
    ? { label: 'Completed', color: 'text-green-600' }
    : { label: 'In Progress', color: 'text-amber-600' };
}

const FAMILY_LABELS: Record<string, string> = {
  lender_dfi: 'Lender / DFI E&S',
  carbon_standard: 'Carbon Standard',
  site_diligence: 'Site Diligence',
};

// If the LLM recommended a framework that already has a saved check, promote
// the first unsaved possibly_relevant entry instead and push the saved one into
// not_activated so it appears at the bottom of "Other".
function demoteSavedFramework(
  result: FrameworkRoutingResult,
  savedPrechecks: Record<string, CompliancePrecheck>,
  allFrameworks: FrameworkListItem[],
): FrameworkRoutingResult {
  if (!savedPrechecks[result.framework.id]) return result;

  const firstUnsaved = result.framework.possibly_relevant?.find(
    pr => !savedPrechecks[pr.id],
  );

  if (!firstUnsaved) {
    // All options are saved — nothing to promote, just return as-is
    return result;
  }

  const promotedMeta = allFrameworks.find(f => f.id === firstUnsaved.id);
  if (!promotedMeta) return result;

  // Build a FrameworkInfo for the promoted framework
  const promoted: FrameworkInfo = {
    id: promotedMeta.id,
    family: promotedMeta.family,
    name: promotedMeta.name,
    rationale: firstUnsaved.reason,
    signals: [],
    possibly_relevant: result.framework.possibly_relevant.filter(
      pr => pr.id !== firstUnsaved.id,
    ),
    not_activated: [
      ...result.framework.not_activated,
      { id: result.framework.id, reason: 'Already completed — view the existing report below.' },
    ],
  };

  return { ...result, framework: promoted };
}

interface EvaluateViewProps {
  initiativeId: string;
}

export function EvaluateView({ initiativeId }: EvaluateViewProps) {
  const {
    compliancePrechecks,
    compliancePrecheckLoading,
    routeFramework,
    runCompliancePrecheck,
    rerunCompliancePrecheck,
    loadCompliancePrechecks,
  } = useInitiativeStore();

  const [stage, setStage] = useState<Stage>('idle');
  const [routingResult, setRoutingResult] = useState<FrameworkRoutingResult | null>(null);
  const [selectedFrameworkId, setSelectedFrameworkId] = useState<string | null>(null);
  const [scopeFacts, setScopeFacts] = useState<ScopeFact[]>([]);
  const [allFrameworks, setAllFrameworks] = useState<FrameworkListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCompliancePrechecks(initiativeId);
    api.listComplianceFrameworks(initiativeId).then(r => setAllFrameworks(r.frameworks)).catch(() => {});
  }, [initiativeId, loadCompliancePrechecks]);

  const activePrecheck: CompliancePrecheck | null = useMemo(
    () => (selectedFrameworkId ? compliancePrechecks[selectedFrameworkId] ?? null : null),
    [selectedFrameworkId, compliancePrechecks],
  );

  const savedCheckEntries = useMemo(() => {
    return Object.entries(compliancePrechecks)
      .map(([fwId, check]) => {
        const meta = allFrameworks.find(f => f.id === fwId);
        return meta ? { ...meta, check } : null;
      })
      .filter(Boolean) as (FrameworkListItem & { check: CompliancePrecheck })[];
  }, [compliancePrechecks, allFrameworks]);

  // ── Navigation helpers ────────────────────────────────────────────

  const handleReset = useCallback(() => {
    setStage('idle');
    setRoutingResult(null);
    setSelectedFrameworkId(null);
    setScopeFacts([]);
    setError(null);
  }, []);

  // ── Start Pre-Check: LLM recommends best framework ────────────────

  const handleStartPrecheck = useCallback(async () => {
    setStage('routing');
    setError(null);

    try {
      const fwId = allFrameworks[0]?.id ?? 'ifc_ps';
      const [result, fwResponse] = await Promise.all([
        routeFramework(initiativeId, fwId),
        api.listComplianceFrameworks(initiativeId),
      ]);

      // Demote any already-saved framework away from the recommended slot.
      // If the top pick is already saved, promote the first unsaved possibly_relevant
      // and push the saved framework down into not_activated.
      const adjustedResult = demoteSavedFramework(result, compliancePrechecks, fwResponse.frameworks);

      setRoutingResult(adjustedResult);
      setSelectedFrameworkId(adjustedResult.framework.id);
      setScopeFacts(adjustedResult.scope_facts);
      setAllFrameworks(fwResponse.frameworks);
      setStage('recommendation');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Framework routing failed. Please try again.');
      setStage('idle');
    }
  }, [initiativeId, routeFramework, allFrameworks, compliancePrechecks]);

  const handleContinueToScope = useCallback(() => {
    setStage('scope');
  }, []);

  const handleSelectAlternative = useCallback((frameworkId: string) => {
    setSelectedFrameworkId(frameworkId);
    setStage('scope');
  }, []);

  // ── Run / Rerun ───────────────────────────────────────────────────

  const handleRunPrecheck = useCallback(async (confirmedFacts: ScopeFact[]) => {
    if (!selectedFrameworkId) return;
    setStage('running');
    setError(null);

    try {
      await runCompliancePrecheck(initiativeId, selectedFrameworkId, confirmedFacts, true);
      setStage('results');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pre-check failed. Please try again.');
      setStage('scope');
    }
  }, [initiativeId, selectedFrameworkId, runCompliancePrecheck]);

  const handleEditScope = useCallback(() => {
    if (!activePrecheck) return;
    const existingFacts: ScopeFact[] = activePrecheck.scope_confirmation?.facts ?? [];
    setScopeFacts(existingFacts);
    setSelectedFrameworkId(activePrecheck.framework.id);
    setStage('scope');
  }, [activePrecheck]);

  const handleRerunFromScope = useCallback(async (updatedFacts: ScopeFact[]) => {
    if (!selectedFrameworkId) return;
    setStage('running');
    setError(null);

    try {
      await rerunCompliancePrecheck(initiativeId, selectedFrameworkId, updatedFacts);
      setStage('results');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rerun failed. Please try again.');
      setStage('scope');
    }
  }, [initiativeId, selectedFrameworkId, rerunCompliancePrecheck]);

  const handleViewReport = useCallback((frameworkId: string) => {
    setSelectedFrameworkId(frameworkId);
    setStage('results');
  }, []);

  const isRerun = !!activePrecheck && stage === 'scope';
  const scopeRunHandler = isRerun ? handleRerunFromScope : handleRunPrecheck;

  // ── Results view ───────────────────────────────────────────────────

  if (stage === 'results' && activePrecheck) {
    return (
      <FindingsReport
        precheck={activePrecheck}
        onEditScope={handleEditScope}
        onBack={handleReset}
        rerunning={compliancePrecheckLoading}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* Stage: Idle */}
        {stage === 'idle' && (
          <div className="space-y-6">
            <div className="flex flex-col items-center text-center space-y-5 pt-12">
              <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
                <FlaskConical className="w-6 h-6 text-accent" />
              </div>
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-text-primary">Compliance Pre-Check</h2>
                <p className="text-sm text-text-secondary max-w-md leading-relaxed">
                  Select a compliance framework and run a gap analysis to identify requirements,
                  missing evidence, and items for human review.
                </p>
              </div>
              <button
                onClick={handleStartPrecheck}
                className="btn-primary text-sm"
              >
                Start Pre-Check
              </button>
              {error && (
                <div className="flex items-center gap-2 text-sm text-red-600">
                  <AlertTriangle className="w-4 h-4" />
                  {error}
                </div>
              )}
            </div>

            {/* Saved reports */}
            {savedCheckEntries.length > 0 && (
              <div className="pt-2">
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-0.5 mb-2">
                  Reports
                </h4>
                <div className="space-y-1.5">
                  {savedCheckEntries.map(entry => (
                      <div
                        key={entry.id}
                        className="rounded-lg border border-stroke-subtle bg-white hover:border-accent/30 transition-colors"
                      >
                        <div className="flex items-center justify-between px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-text-primary truncate">{entry.name}</span>
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-subtle text-text-tertiary shrink-0">
                                {FAMILY_LABELS[entry.family] ?? entry.family}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 text-[10px]">
                              <CheckCircle2 className={`w-3 h-3 ${getPrecheckStatus(entry.check).color}`} />
                              <span className={getPrecheckStatus(entry.check).color}>{getPrecheckStatus(entry.check).label}</span>
                              <span className="text-text-tertiary">v{entry.check.version ?? 1}</span>
                              <span className="text-text-tertiary mx-0.5">·</span>
                              <Clock className="w-2.5 h-2.5 text-text-tertiary" />
                              <span className="text-text-tertiary">{new Date(entry.check.generated_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleViewReport(entry.id)}
                            className="btn-secondary !text-xs !px-3 !py-1 shrink-0 ml-3"
                          >
                            View Report
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Stage: Routing */}
        {stage === 'routing' && (
          <div className="flex items-center justify-center pt-16">
            <PageLoader label="Analyzing project…" />
          </div>
        )}

        {/* Stage: Recommendation */}
        {stage === 'recommendation' && routingResult && (
          <div className="space-y-6">
            <button
              onClick={handleReset}
              className="icon-btn p-1.5 text-text-tertiary -ml-1"
              title="Back to evaluate home"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <div>
              <h2 className="text-base font-semibold text-text-primary">Recommended Framework</h2>
              <p className="text-xs text-text-secondary mt-1">
                Based on your project workspace, Nitrogen recommends the following framework.
              </p>
            </div>
            <FrameworkRecommendation
              framework={routingResult.framework}
              allFrameworks={allFrameworks}
              savedPrechecks={compliancePrechecks}
              onContinue={handleContinueToScope}
              onSelectAlternative={handleSelectAlternative}
              onViewReport={handleViewReport}
            />
          </div>
        )}

        {/* Stage: Scope confirmation */}
        {stage === 'scope' && (
          <div className="space-y-6">
            <button
              onClick={isRerun ? () => setStage('results') : () => setStage('recommendation')}
              className="icon-btn p-1.5 text-text-tertiary -ml-1"
              title={isRerun ? 'Back to report' : 'Back to framework selection'}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <ScopeConfirmation
              facts={scopeFacts}
              frameworkName={
                allFrameworks.find((f) => f.id === selectedFrameworkId)?.name ??
                activePrecheck?.framework.name ??
                routingResult?.framework.name ??
                'selected framework'
              }
              onRun={scopeRunHandler}
              running={false}
              isRerun={isRerun}
            />
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600">
                <AlertTriangle className="w-4 h-4" />
                {error}
              </div>
            )}
          </div>
        )}

        {/* Stage: Running */}
        {stage === 'running' && (
          <div className="flex items-center justify-center pt-16">
            <PageLoader
              label={isRerun
                ? 'Rerunning pre-check against project evidence…'
                : 'Running compliance pre-check…'}
            />
          </div>
        )}
      </div>
    </div>
  );
}
