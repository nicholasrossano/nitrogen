'use client';

import { AlertCircle, Loader2, Play, CheckCircle2 } from 'lucide-react';
import type { AssessmentAgentStatus } from '@/lib/api';

interface AgentStatusHeaderProps {
  status: AssessmentAgentStatus | null;
  loading?: boolean;
  onOpen?: () => void;
  approvedMeta?: string | null;
}

function stateLabel(runState?: AssessmentAgentStatus['run_state']): string {
  switch (runState) {
    case 'running':
      return 'Running';
    case 'blocked':
      return 'Blocked';
    case 'approved':
      return 'Approved';
    case 'needs_review':
    default:
      return 'Needs review';
  }
}

export function AgentStatusHeader({ status, loading = false, onOpen, approvedMeta = null }: AgentStatusHeaderProps) {
  if (!status && !loading) return null;

  const runState = status?.run_state;
  const isRunning = runState === 'running';
  const isBlocked = runState === 'blocked';
  const isApproved = runState === 'approved';
  const summary = status?.current_action || status?.last_summary;
  const displaySummary = isApproved && approvedMeta ? approvedMeta : summary;

  return (
    <div className="flex items-center justify-between rounded-lg border border-divider bg-surface px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        {loading || isRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent shrink-0" />
        ) : isBlocked ? (
          <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-primary">
            {stateLabel(runState)}
          </p>
          {displaySummary && (
            <p className="text-xs text-text-tertiary truncate">
              {displaySummary}
            </p>
          )}
        </div>
      </div>
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="btn-secondary !py-1 !px-2 !text-[11px] !font-medium !rounded-md shrink-0"
          disabled={loading}
        >
          <span className="inline-flex items-center gap-1">
            <Play className="h-3 w-3" />
            Open
          </span>
        </button>
      )}
    </div>
  );
}
