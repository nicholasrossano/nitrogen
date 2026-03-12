'use client';

import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, Loader2, AlertTriangle } from 'lucide-react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import type { FrameworkRoutingResult, ScopeFact, FrameworkListItem } from '@/lib/api';
import { api } from '@/lib/api';
import { FrameworkRecommendation } from './FrameworkRecommendation';
import { ScopeConfirmation } from './ScopeConfirmation';
import { FindingsReport } from './FindingsReport';

type Stage = 'idle' | 'routing' | 'recommendation' | 'scope' | 'running' | 'results';

interface EvaluateViewProps {
  initiativeId: string;
}

export function EvaluateView({ initiativeId }: EvaluateViewProps) {
  const {
    compliancePrecheck,
    compliancePrecheckLoading,
    routeFramework,
    runCompliancePrecheck,
    rerunCompliancePrecheck,
    loadCompliancePrecheck,
  } = useInitiativeStore();

  const [stage, setStage] = useState<Stage>('idle');
  const [routingResult, setRoutingResult] = useState<FrameworkRoutingResult | null>(null);
  const [selectedFrameworkId, setSelectedFrameworkId] = useState<string | null>(null);
  const [scopeFacts, setScopeFacts] = useState<ScopeFact[]>([]);
  const [allFrameworks, setAllFrameworks] = useState<FrameworkListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (compliancePrecheck) {
      setStage('results');
    }
  }, [compliancePrecheck]);

  const handleStartPrecheck = useCallback(async () => {
    setStage('routing');
    setError(null);

    try {
      const [result, fwResponse] = await Promise.all([
        routeFramework(initiativeId),
        api.listComplianceFrameworks(initiativeId),
      ]);
      setRoutingResult(result);
      setSelectedFrameworkId(result.framework.id);
      setScopeFacts(result.scope_facts);
      setAllFrameworks(fwResponse.frameworks);
      setStage('recommendation');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Framework routing failed. Please try again.');
      setStage('idle');
    }
  }, [initiativeId, routeFramework]);

  const handleContinueToScope = useCallback(() => {
    setStage('scope');
  }, []);

  const handleSelectAlternative = useCallback((frameworkId: string) => {
    setSelectedFrameworkId(frameworkId);
    setStage('scope');
  }, []);

  const handleRunPrecheck = useCallback(async (confirmedFacts: ScopeFact[]) => {
    if (!selectedFrameworkId) return;
    setStage('running');
    setError(null);

    try {
      await runCompliancePrecheck(initiativeId, selectedFrameworkId, confirmedFacts);
      setStage('results');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pre-check failed. Please try again.');
      setStage('scope');
    }
  }, [initiativeId, selectedFrameworkId, runCompliancePrecheck]);

  const handleRerun = useCallback(async () => {
    if (!compliancePrecheck) return;
    setError(null);

    try {
      await rerunCompliancePrecheck(initiativeId, compliancePrecheck.scope_confirmation.facts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rerun failed. Please try again.');
    }
  }, [initiativeId, compliancePrecheck, rerunCompliancePrecheck]);

  const handleReset = useCallback(() => {
    setStage('idle');
    setRoutingResult(null);
    setSelectedFrameworkId(null);
    setScopeFacts([]);
    setError(null);
  }, []);

  // Results view
  if (stage === 'results' && compliancePrecheck) {
    return (
      <FindingsReport
        precheck={compliancePrecheck}
        onRerun={handleRerun}
        rerunning={compliancePrecheckLoading}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* Stage: Idle */}
        {stage === 'idle' && (
          <div className="flex flex-col items-center text-center space-y-5 pt-12">
            <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
              <FlaskConical className="w-6 h-6 text-accent" />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-text-primary">Compliance Pre-Check</h2>
              <p className="text-sm text-text-secondary max-w-md leading-relaxed">
                Nitrogen will analyze your project workspace, recommend the most relevant
                compliance framework, and run a gap analysis to identify supported requirements,
                missing evidence, and items that need human review.
              </p>
            </div>
            {compliancePrecheck && (
              <button
                onClick={() => setStage('results')}
                className="btn-secondary text-sm"
              >
                View existing report
              </button>
            )}
            <button
              onClick={handleStartPrecheck}
              className="btn-primary text-sm"
            >
              {compliancePrecheck ? 'Run New Pre-Check' : 'Start Pre-Check'}
            </button>
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600">
                <AlertTriangle className="w-4 h-4" />
                {error}
              </div>
            )}
          </div>
        )}

        {/* Stage: Routing */}
        {stage === 'routing' && (
          <div className="flex flex-col items-center text-center space-y-4 pt-16">
            <Loader2 className="w-6 h-6 text-accent animate-spin" />
            <p className="text-sm text-text-secondary">Analyzing project workspace...</p>
          </div>
        )}

        {/* Stage: Recommendation */}
        {stage === 'recommendation' && routingResult && (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold text-text-primary">Recommended Framework</h2>
              <p className="text-xs text-text-secondary mt-1">
                Based on your project workspace, Nitrogen recommends the following framework.
              </p>
            </div>
            <FrameworkRecommendation
              framework={routingResult.framework}
              allFrameworks={allFrameworks}
              onContinue={handleContinueToScope}
              onSelectAlternative={handleSelectAlternative}
            />
          </div>
        )}

        {/* Stage: Scope confirmation */}
        {stage === 'scope' && (
          <div className="space-y-6">
            <button
              onClick={() => setStage('recommendation')}
              className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
            >
              &larr; Back to framework selection
            </button>
            <ScopeConfirmation
              facts={scopeFacts}
              frameworkName={
                allFrameworks.find((f) => f.id === selectedFrameworkId)?.name ??
                routingResult?.framework.name ??
                'selected framework'
              }
              onRun={handleRunPrecheck}
              running={false}
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
          <div className="flex flex-col items-center text-center space-y-4 pt-16">
            <Loader2 className="w-6 h-6 text-accent animate-spin" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-text-primary">Running compliance pre-check</p>
              <p className="text-xs text-text-secondary">
                Evaluating requirements against project evidence. This may take a minute.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
