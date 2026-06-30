'use client';

import { useState, useCallback } from 'react';
import { CheckCircle2, Sparkles, AlertTriangle } from 'lucide-react';
import { persistChatWidgetUpdate } from '@/lib/chatWidgetUpdates';

export interface ProposedValueApplyRequest {
  fieldName: string;
  value: number;
  modelType: 'lcoe' | 'carbon' | 'solar';
}

interface ProposedValueWidgetProps {
  data: {
    field_name: string;
    label?: string;
    unit?: string;
    proposed_value: number;
    model_type: 'lcoe' | 'carbon' | 'solar';
    confidence: 'high' | 'moderate' | 'low';
    explanation: string;
    confirmed?: boolean;
    dismissed?: boolean;
  };
  projectId?: string;
  messageId?: string;
  onApplyValue?: (request: ProposedValueApplyRequest) => boolean | Promise<boolean>;
  onConfirmed?: (fieldName: string, value: number, modelType: string) => void;
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

function formatValue(value: number, unit?: string): string {
  const formatted = value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  const normalizedUnit = (unit || '').trim();
  if (!normalizedUnit || ['unitless', 'none', 'n/a', 'na', 'null', 'no unit'].includes(normalizedUnit.toLowerCase())) {
    return formatted;
  }
  const currencyUnits = ['usd', 'eur', 'gbp'];
  const lowerUnit = normalizedUnit.toLowerCase();
  if (currencyUnits.some(c => lowerUnit.includes(c))) {
    return `${formatted} ${normalizedUnit}`;
  }
  return `${formatted} ${normalizedUnit}`;
}

export function ProposedValueWidget({
  data,
  projectId,
  messageId,
  onApplyValue,
  onConfirmed,
}: ProposedValueWidgetProps) {
  const initialStatus = data.confirmed ? 'confirmed' : data.dismissed ? 'dismissed' : 'pending';
  const [status, setStatus] = useState<'pending' | 'confirmed' | 'dismissed'>(initialStatus);
  const confStyle = CONFIDENCE_STYLES[data.confidence] || CONFIDENCE_STYLES.moderate;
  const displayLabel = data.label || data.field_name.replace(/_/g, ' ');

  const handleConfirm = useCallback(async () => {
    if (onApplyValue) {
      const applied = await onApplyValue({
        fieldName: data.field_name,
        value: data.proposed_value,
        modelType: data.model_type,
      });
      if (!applied) return;
    }

    const newData = { ...data, confirmed: true, dismissed: false };
    const persisted = await persistChatWidgetUpdate({
      projectId,
      messageId,
      widgetData: newData,
      source: 'ProposedValueWidget',
    });
    if (!persisted) return;

    setStatus('confirmed');
    if (!onApplyValue) {
      window.dispatchEvent(new CustomEvent('nitrogen:input-confirmed', {
        detail: {
          field_name: data.field_name,
          value: data.proposed_value,
          model_type: data.model_type,
        },
      }));
    }
    onConfirmed?.(data.field_name, data.proposed_value, data.model_type);
  }, [data, projectId, messageId, onApplyValue, onConfirmed]);

  const handleDismiss = useCallback(async () => {
    const newData = { ...data, dismissed: true, confirmed: false };
    const persisted = await persistChatWidgetUpdate({
      projectId,
      messageId,
      widgetData: newData,
      source: 'ProposedValueWidget',
    });
    if (!persisted) return;

    setStatus('dismissed');
  }, [data, projectId, messageId]);

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
              {isConfirmed ? 'Value Confirmed' : 'Proposed Value'}
            </span>
            {!isConfirmed && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${confStyle.bg} ${confStyle.text}`}>
                {confStyle.label}
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className={`text-lg font-bold tabular-nums ${isConfirmed ? 'text-green-800' : 'text-text-primary'}`}>
              {formatValue(data.proposed_value, data.unit)}
            </span>
            <span className="text-xs text-text-secondary">
              for {displayLabel}
            </span>
          </div>
          {data.explanation && !isConfirmed && (
            <p className="text-xs text-text-secondary leading-relaxed">{data.explanation}</p>
          )}
          {isConfirmed && (
            <p className="text-xs text-green-600">Model will use the new value.</p>
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
            Accept & Update Model
          </button>
        </div>
      )}
    </div>
  );
}
