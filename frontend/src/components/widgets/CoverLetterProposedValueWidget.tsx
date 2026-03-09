'use client';

import { useState, useCallback } from 'react';
import { CheckCircle2, Sparkles, AlertTriangle } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';

interface CoverLetterProposedValueWidgetProps {
  data: {
    field_id: string;
    proposed_value: string;
    confidence: 'high' | 'moderate' | 'low';
    explanation: string;
    confirmed?: boolean;
    dismissed?: boolean;
  };
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

export function CoverLetterProposedValueWidget({ data, messageId }: CoverLetterProposedValueWidgetProps) {
  const initialStatus = data.confirmed ? 'confirmed' : data.dismissed ? 'dismissed' : 'pending';
  const [status, setStatus] = useState<'pending' | 'confirmed' | 'dismissed'>(initialStatus);
  const confStyle = CONFIDENCE_STYLES[data.confidence] || CONFIDENCE_STYLES.moderate;
  const displayLabel = data.field_id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const handleConfirm = useCallback(() => {
    setStatus('confirmed');
    const newData = { ...data, confirmed: true, dismissed: false };
    if (messageId) {
      useChatStore.getState().updateMessageWidgetData(messageId, newData);
    }
    window.dispatchEvent(new CustomEvent('nitrogen:cover-letter-field-confirmed', {
      detail: {
        field_id: data.field_id,
        value: data.proposed_value,
      },
    }));
  }, [data, messageId]);

  const handleDismiss = useCallback(() => {
    setStatus('dismissed');
    if (messageId) {
      useChatStore.getState().updateMessageWidgetData(messageId, { ...data, dismissed: true, confirmed: false });
    }
  }, [data, messageId]);

  if (status === 'dismissed') {
    return (
      <div className="rounded-lg border border-stroke-subtle bg-surface-subtle px-4 py-2.5 text-xs text-text-tertiary">
        Value proposal dismissed
      </div>
    );
  }

  const isConfirmed = status === 'confirmed';

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
              {isConfirmed ? 'Value Applied' : 'Proposed Value'}
            </span>
            <span className="text-[10px] text-text-tertiary">Cover Letter</span>
            {!isConfirmed && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${confStyle.bg} ${confStyle.text}`}>
                {confStyle.label}
              </span>
            )}
          </div>
          <div className="mb-1">
            <span className="text-xs text-text-secondary">
              {displayLabel}:
            </span>
            <p className={`text-sm font-medium mt-0.5 ${isConfirmed ? 'text-green-800' : 'text-text-primary'}`}>
              {data.proposed_value.length > 200 ? `${data.proposed_value.slice(0, 200)}...` : data.proposed_value}
            </p>
          </div>
          {data.explanation && !isConfirmed && (
            <p className="text-xs text-text-secondary leading-relaxed">{data.explanation}</p>
          )}
          {isConfirmed && (
            <p className="text-xs text-green-600">Value applied to Cover Letter.</p>
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
            Accept & Apply
          </button>
        </div>
      )}
    </div>
  );
}
