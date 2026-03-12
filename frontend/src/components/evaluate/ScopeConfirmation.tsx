'use client';

import { useState } from 'react';
import { Check, HelpCircle, Loader2 } from 'lucide-react';
import type { ScopeFact } from '@/lib/api';

interface ScopeConfirmationProps {
  facts: ScopeFact[];
  frameworkName: string;
  onRun: (confirmedFacts: ScopeFact[]) => void;
  running?: boolean;
}

export function ScopeConfirmation({ facts, frameworkName, onRun, running }: ScopeConfirmationProps) {
  const [editableFacts, setEditableFacts] = useState<ScopeFact[]>(
    facts.map((f) => ({ ...f, confirmed: f.source === 'auto' }))
  );

  const handleValueChange = (id: string, value: string) => {
    setEditableFacts((prev) =>
      prev.map((f) => (f.id === id ? { ...f, value, confirmed: true } : f))
    );
  };

  const handleConfirm = (id: string) => {
    setEditableFacts((prev) =>
      prev.map((f) => (f.id === id ? { ...f, confirmed: true } : f))
    );
  };

  const allConfirmed = editableFacts.every((f) => f.confirmed);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">Scope Confirmation</h3>
        <p className="text-xs text-text-secondary mt-1">
          Review the facts below before running the pre-check against {frameworkName}.
          Auto-detected facts are pre-filled. Confirm or adjust any items marked for review.
        </p>
      </div>

      <div className="space-y-2">
        {editableFacts.map((fact) => (
          <div
            key={fact.id}
            className={`border rounded-lg px-4 py-3 transition-colors ${
              fact.confirmed
                ? 'border-divider bg-white'
                : 'border-amber-200 bg-amber-50/50'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{fact.label}</span>
                  {fact.source === 'auto' && fact.confirmed && (
                    <span className="text-[10px] text-emerald-600 flex items-center gap-0.5">
                      <Check className="w-3 h-3" />
                      Auto-detected
                    </span>
                  )}
                  {fact.source === 'needs_confirmation' && !fact.confirmed && (
                    <span className="text-[10px] text-amber-600 flex items-center gap-0.5">
                      <HelpCircle className="w-3 h-3" />
                      Needs confirmation
                    </span>
                  )}
                </div>
                <div className="mt-1.5">
                  <input
                    type="text"
                    value={fact.value}
                    onChange={(e) => handleValueChange(fact.id, e.target.value)}
                    className="w-full text-sm px-2.5 py-1.5 border border-divider rounded bg-white focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 text-text-primary"
                  />
                </div>
              </div>
              {!fact.confirmed && (
                <button
                  onClick={() => handleConfirm(fact.id)}
                  className="text-xs text-accent hover:underline mt-1 whitespace-nowrap"
                >
                  Confirm
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => onRun(editableFacts)}
        disabled={!allConfirmed || running}
        className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {running ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Running pre-check...
          </>
        ) : (
          'Run Pre-Check'
        )}
      </button>

      {!allConfirmed && (
        <p className="text-[11px] text-amber-600">
          Please confirm all facts before running the pre-check.
        </p>
      )}
    </div>
  );
}
