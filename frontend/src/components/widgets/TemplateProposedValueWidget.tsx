'use client';

import { useState, useCallback } from 'react';
import { CheckCircle2, Sparkles, AlertTriangle, ExternalLink } from 'lucide-react';
import { persistChatWidgetUpdate } from '@/lib/chatWidgetUpdates';

interface TemplateProposedValueWidgetProps {
  data: {
    requirement_label: string;
    field_type: string;
    proposed_value: string;
    can_be_determined: boolean;
    confidence: 'high' | 'moderate' | 'low';
    explanation: string;
    confirmed?: boolean;
    dismissed?: boolean;
  };
  projectId?: string;
  messageId?: string;
}

const CONFIDENCE_STYLES = {
  high: { bg: 'bg-green-50', text: 'text-green-700', label: 'High confidence' },
  moderate: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Moderate confidence' },
  low: { bg: 'bg-red-50', text: 'text-red-700', label: 'Low confidence' },
};

function ConfidenceIcon({ confidence, className }: { confidence: string; className?: string }) {
  if (confidence === 'high') return <CheckCircle2 className={className} />;
  if (confidence === 'low') return <AlertTriangle className={className} />;
  return <Sparkles className={className} />;
}

export function TemplateProposedValueWidget({ data, projectId, messageId }: TemplateProposedValueWidgetProps) {
  const initialStatus = data.confirmed ? 'confirmed' : data.dismissed ? 'dismissed' : 'pending';
  const [status, setStatus] = useState<'pending' | 'confirmed' | 'dismissed'>(initialStatus);
  const confStyle = CONFIDENCE_STYLES[data.confidence] || CONFIDENCE_STYLES.moderate;
  const hasProposal = data.can_be_determined && data.proposed_value;

  const handleConfirm = useCallback(async () => {
    const newData = { ...data, confirmed: true, dismissed: false };
    const persisted = await persistChatWidgetUpdate({
      projectId,
      messageId,
      widgetData: newData,
      source: 'TemplateProposedValueWidget',
    });
    if (!persisted) return;

    setStatus('confirmed');
    window.dispatchEvent(new CustomEvent('nitrogen:template-field-confirmed', {
      detail: {
        requirement_label: data.requirement_label,
        value: data.proposed_value,
      },
    }));
  }, [data, projectId, messageId]);

  const handleDismiss = useCallback(async () => {
    const newData = { ...data, dismissed: true, confirmed: false };
    const persisted = await persistChatWidgetUpdate({
      projectId,
      messageId,
      widgetData: newData,
      source: 'TemplateProposedValueWidget',
    });
    if (!persisted) return;

    setStatus('dismissed');
  }, [data, projectId, messageId]);

  if (status === 'dismissed') {
    return (
      <div className="rounded-lg border border-stroke-subtle bg-surface-subtle px-4 py-2.5 text-xs text-text-tertiary">
        Proposal dismissed
      </div>
    );
  }

  const isConfirmed = status === 'confirmed';

  if (!hasProposal) {
    return (
      <div className="rounded-lg border border-yellow-200 overflow-hidden bg-white">
        <div className="px-4 py-3 flex items-start gap-3">
          <div className="mt-0.5 shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-yellow-50">
            <ExternalLink className="w-3.5 h-3.5 text-yellow-700" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                Requires Offline Data
              </span>
            </div>
            <p className="text-xs text-text-secondary mb-1">
              <strong className="text-text-primary">{data.requirement_label}</strong>
            </p>
            {data.explanation && (
              <p className="text-xs text-text-secondary leading-relaxed">{data.explanation}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border overflow-hidden ${isConfirmed ? 'border-green-200' : 'border-stroke-subtle'} bg-white`}>
      <div className="px-4 py-3 flex items-start gap-3">
        <div className={`mt-0.5 shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${isConfirmed ? 'bg-green-50' : confStyle.bg}`}>
          {isConfirmed ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
          ) : (
            <ConfidenceIcon confidence={data.confidence} className={`w-3.5 h-3.5 ${confStyle.text}`} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              {isConfirmed ? 'Value Accepted' : 'Proposed Value'}
            </span>
            {!isConfirmed && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${confStyle.bg} ${confStyle.text}`}>
                {confStyle.label}
              </span>
            )}
          </div>
          <p className="text-xs text-text-secondary mb-1">{data.requirement_label}</p>
          <p className={`text-sm font-medium ${isConfirmed ? 'text-green-800' : 'text-text-primary'}`}>
            {data.proposed_value.length > 300 ? `${data.proposed_value.slice(0, 300)}...` : data.proposed_value}
          </p>
          {data.explanation && !isConfirmed && (
            <p className="text-xs text-text-secondary leading-relaxed mt-1">{data.explanation}</p>
          )}
          {isConfirmed && (
            <p className="text-xs text-green-600 mt-1">Value accepted in this chat.</p>
          )}
        </div>
      </div>

      {!isConfirmed && (
        <div className="px-4 py-2.5 bg-surface-subtle border-t border-stroke-subtle flex items-center justify-end gap-2">
          <button
            onClick={handleDismiss}
            className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors rounded"
          >
            Dismiss
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-anchor rounded transition-colors"
          >
            Accept
          </button>
        </div>
      )}
    </div>
  );
}
