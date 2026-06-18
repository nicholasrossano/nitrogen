'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, Loader2, PauseCircle, PlayCircle } from 'lucide-react';
import {
  api,
  type AssessmentActivityLog,
  type AssessmentActivityLogEntry,
  type StagedAssessmentWorkflowState,
} from '@/lib/api';

interface AssessmentActivityLogTabProps {
  instanceId: string;
  assessmentId: string;
  assessmentTitle: string;
  onOpenModule?: (context: { instanceId: string; assessmentId: string; title: string }) => void;
}

function runStateLabel(runState: AssessmentActivityLog['run_state']): string {
  if (runState === 'running') return 'Running';
  if (runState === 'blocked') return 'Blocked';
  if (runState === 'approved') return 'Confirmed';
  return 'Needs review';
}

function runStateTone(runState: AssessmentActivityLog['run_state']): string {
  if (runState === 'running') return 'text-accent bg-accent-wash';
  if (runState === 'blocked') return 'text-red-600 bg-red-50';
  if (runState === 'approved') return 'text-emerald-700 bg-emerald-50';
  return 'text-amber-700 bg-amber-50';
}

function eventIcon(entry: AssessmentActivityLogEntry) {
  if (entry.event_type === 'agent_started') return <PlayCircle className="h-4 w-4 text-accent" />;
  if (entry.event_type === 'agent_action') return <Clock3 className="h-4 w-4 text-text-tertiary" />;
  if (entry.event_type === 'agent_paused') return <PauseCircle className="h-4 w-4 text-amber-600" />;
  if (entry.event_type === 'agent_blocked') return <AlertCircle className="h-4 w-4 text-red-500" />;
  return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
}

export function AssessmentActivityLogTab({
  instanceId,
  assessmentId,
  assessmentTitle,
  onOpenModule,
}: AssessmentActivityLogTabProps) {
  const [log, setLog] = useState<AssessmentActivityLog | null>(null);
  const [workflow, setWorkflow] = useState<StagedAssessmentWorkflowState | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmingStageId, setConfirmingStageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLog = useCallback(async () => {
    try {
      const [nextLog, nextWorkflow] = await Promise.all([
        api.getAssessmentActivityLog(instanceId),
        api.getStagedAssessmentWorkflowState(instanceId),
      ]);
      setLog(nextLog);
      setWorkflow(nextWorkflow);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load activity log.');
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    setLoading(true);
    void loadLog();
  }, [loadLog]);

  useEffect(() => {
    if (log?.run_state !== 'running') return undefined;
    const id = window.setInterval(() => {
      void loadLog();
    }, 3000);
    return () => window.clearInterval(id);
  }, [log?.run_state, loadLog]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-accent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full p-4 text-sm text-red-500 flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        <span>{error}</span>
      </div>
    );
  }

  const entries = log?.entries ?? [];
  const stages = workflow?.workflow_state?.stages ?? {};

  const canConfirmEntry = (entry: AssessmentActivityLogEntry): boolean => {
    if (!entry.stage_id) return false;
    if (entry.event_type !== 'agent_paused') return false;
    const stageState = stages[entry.stage_id];
    if (!stageState) return false;
    const status = stageState.status;
    if (status === 'confirmed' || status === 'validated') return false;
    const hasData = Boolean(
      stageState.data?.items?.length
      || stageState.data?.records
      || stageState.data?.widget_data,
    );
    return status === 'draft' || (status === 'pending' && hasData);
  };

  const handleConfirmFromLog = async (entry: AssessmentActivityLogEntry) => {
    if (!entry.stage_id || !workflow) return;
    setConfirmingStageId(entry.stage_id);
    try {
      const result = await api.confirmStage(instanceId, entry.stage_id, workflow.workflow_version);
      setWorkflow((prev) => (
        prev
          ? {
              ...prev,
              workflow_state: result.workflow_state,
              workflow_version: result.workflow_version,
            }
          : prev
      ));
      window.dispatchEvent(new CustomEvent('nitrogen:assessment-workflow-updated', {
        detail: {
          instanceId,
          assessmentId,
          stageId: entry.stage_id,
        },
      }));
      void loadLog();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to confirm stage.');
    } finally {
      setConfirmingStageId(null);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="border-b border-divider px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Activity Log</h3>
          <p className="text-xs text-text-tertiary truncate">{assessmentTitle}</p>
        </div>
        <span className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-medium ${runStateTone(log?.run_state ?? 'needs_review')}`}>
          {runStateLabel(log?.run_state ?? 'needs_review')}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {entries.length === 0 ? (
          <p className="text-sm text-text-tertiary">No agent activity recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => {
              const showConfirm = canConfirmEntry(entry);
              const isConfirming = confirmingStageId === entry.stage_id;
              return (
              <div key={`${entry.sequence_number}-${entry.event_type}`} className="rounded-lg border border-divider bg-surface p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5">{eventIcon(entry)}</span>
                    <div>
                      <p className="text-xs font-medium text-text-primary">{entry.label}</p>
                      <p className="text-xs text-text-tertiary">
                        {entry.stage_title ?? 'Assessment'} - {new Date(entry.occurred_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {entry.is_decision_point && (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex rounded bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700">
                        Decision point
                      </span>
                    </div>
                  )}
                </div>
                {entry.summary && (
                  <p className="mt-2 text-xs text-text-secondary">{entry.summary}</p>
                )}
                {showConfirm && (
                  <div className="mt-2 flex justify-end">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenModule?.({ instanceId, assessmentId, title: assessmentTitle })}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-divider bg-white px-2.5 text-[10px] font-medium text-text-secondary hover:bg-white hover:text-text-primary"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirmFromLog(entry)}
                        disabled={isConfirming}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-accent bg-accent px-2.5 text-[10px] font-medium text-white hover:bg-accent disabled:cursor-default disabled:opacity-70"
                      >
                        {isConfirming ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Confirming...
                          </>
                        ) : (
                          'Confirm'
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
