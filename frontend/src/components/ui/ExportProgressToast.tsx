'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, X, XCircle } from 'lucide-react';

export type ExportToastStepStatus = 'pending' | 'active' | 'done' | 'error';

export interface ExportToastStep {
  id: string;
  label: string;
  detail?: string;
  status: ExportToastStepStatus;
}

export type ExportToastPhase = 'running' | 'success' | 'error';

interface ExportProgressToastProps {
  title: string;
  steps: ExportToastStep[];
  phase: ExportToastPhase;
  errorMessage?: string | null;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 4500;
const TICK_MS = 80;

export function buildExportToastSteps(exportFormat: string | null | undefined): ExportToastStep[] {
  if (exportFormat === 'docx') {
    return [
      {
        id: 'enrich',
        label: 'Filling remaining research',
        detail: 'Running deep dives that were not opened yet so the document has full detail.',
        status: 'active',
      },
      {
        id: 'writeup',
        label: 'Drafting the write-up',
        detail: 'Reuses the latest version if nothing changed; otherwise iterates it for continuity.',
        status: 'pending',
      },
      {
        id: 'download',
        label: 'Preparing download',
        detail: 'Packaging the assessment document for your browser.',
        status: 'pending',
      },
    ];
  }

  return [
    {
      id: 'build',
      label: 'Building export',
      detail: 'Assembling confirmed assessment data into a spreadsheet.',
      status: 'active',
    },
    {
      id: 'download',
      label: 'Preparing download',
      detail: 'Packaging the file for your browser.',
      status: 'pending',
    },
  ];
}

/** Advance the active step while export is still running (heuristic; backend is not streamed). */
export function advanceExportToastSteps(steps: ExportToastStep[]): ExportToastStep[] {
  const activeIdx = steps.findIndex((step) => step.status === 'active');
  if (activeIdx < 0 || activeIdx >= steps.length - 1) return steps;
  return steps.map((step, index) => {
    if (index < activeIdx) return { ...step, status: 'done' as const };
    if (index === activeIdx) return { ...step, status: 'done' as const };
    if (index === activeIdx + 1) return { ...step, status: 'active' as const };
    return step;
  });
}

export function markExportToastComplete(steps: ExportToastStep[]): ExportToastStep[] {
  return steps.map((step) => ({ ...step, status: 'done' as const }));
}

export function markExportToastFailed(steps: ExportToastStep[]): ExportToastStep[] {
  const activeIdx = steps.findIndex((step) => step.status === 'active');
  return steps.map((step, index) => {
    if (activeIdx >= 0 && index === activeIdx) return { ...step, status: 'error' as const };
    if (step.status === 'active') return { ...step, status: 'error' as const };
    return step;
  });
}

export function ExportProgressToast({
  title,
  steps,
  phase,
  errorMessage,
  onDismiss,
}: ExportProgressToastProps) {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(1);
  const remainingRef = useRef(AUTO_DISMISS_MS);
  const lastTickRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const settled = phase === 'success' || phase === 'error';

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!settled) return;

    remainingRef.current = AUTO_DISMISS_MS;
    lastTickRef.current = Date.now();
    setProgress(1);

    timerRef.current = setInterval(() => {
      const now = Date.now();
      remainingRef.current -= now - lastTickRef.current;
      lastTickRef.current = now;

      const next = Math.max(0, remainingRef.current / AUTO_DISMISS_MS);
      setProgress(next);

      if (remainingRef.current <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        setVisible(false);
        setTimeout(onDismiss, 200);
      }
    }, TICK_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [settled, onDismiss]);

  const handleDismiss = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setVisible(false);
    setTimeout(onDismiss, 200);
  };

  const headerLabel =
    phase === 'error'
      ? 'Export failed'
      : phase === 'success'
        ? 'Export ready'
        : title;

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 w-[300px] bg-white border border-divider shadow-xl flex flex-col transition-all duration-200 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start justify-between px-4 pt-4 pb-3 border-b border-divider">
        <div className="flex items-start gap-2 flex-1 min-w-0 pr-2">
          {phase === 'running' ? (
            <Loader2 className="w-3.5 h-3.5 text-accent animate-spin flex-shrink-0 mt-0.5" />
          ) : phase === 'error' ? (
            <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-widest mb-1">
              Assessment export
            </p>
            <p className="text-sm font-medium text-text-primary leading-snug">{headerLabel}</p>
            {phase === 'error' && errorMessage && (
              <p className="text-xs text-red-400 mt-1 leading-snug">{errorMessage}</p>
            )}
            {phase === 'success' && (
              <p className="text-xs text-text-tertiary mt-1 leading-snug">
                Your download should start automatically.
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="w-5 h-5 flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors flex-shrink-0 mt-0.5"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-4 py-3 space-y-2.5 max-h-56 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        {steps.map((step) => (
          <div key={step.id} className="flex items-start gap-2">
            {step.status === 'active' && (
              <Loader2 className="w-3 h-3 text-accent animate-spin flex-shrink-0 mt-0.5" />
            )}
            {step.status === 'done' && (
              <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0 mt-0.5" />
            )}
            {step.status === 'error' && (
              <XCircle className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />
            )}
            {step.status === 'pending' && (
              <span className="w-3 h-3 rounded-full border border-stroke-subtle flex-shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
              <p
                className={`text-xs leading-snug ${
                  step.status === 'pending' ? 'text-text-tertiary' : 'text-text-primary'
                }`}
              >
                {step.label}
              </p>
              {step.detail && (step.status === 'active' || step.status === 'error') && (
                <p className="text-[10px] text-text-tertiary mt-0.5 leading-snug">{step.detail}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="h-[3px] bg-surface-subtle overflow-hidden">
        <div
          className={`h-full origin-left ${phase === 'error' ? 'bg-red-400' : 'bg-accent'}`}
          style={{
            transform: `scaleX(${settled ? progress : 1})`,
            transition: settled ? `transform ${TICK_MS}ms linear` : 'none',
          }}
        />
      </div>
    </div>
  );
}
