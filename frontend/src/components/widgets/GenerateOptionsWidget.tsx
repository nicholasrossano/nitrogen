'use client';

import { useState } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { Sparkles, Loader2, Check, Library } from 'lucide-react';

interface GenerateOptionsWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
}

export function GenerateOptionsWidget({ data, initiativeId, isActive = true }: GenerateOptionsWidgetProps) {
  const [includeCorpus, setIncludeCorpus] = useState(true);
  const { generateMemo, generating } = useInitiativeStore();

  const handleGenerate = async () => {
    await generateMemo(initiativeId, includeCorpus);
  };

  return (
    <div className="card-elevated overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 bg-surface-header border-b border-divider">
        <h3 className="text-sm font-semibold text-text-primary">Generate Memo</h3>
        <p className="text-sm text-text-secondary">
          Evidence received: {data.chunk_count || 0} sections processed
        </p>
      </div>

      {/* Options */}
      <div className="p-5 space-y-4 bg-white">
        {/* Memo option (always selected) */}
        <div className="flex items-start gap-3 p-4 bg-accent-wash/50 border border-accent-tint rounded">
          <div className="w-5 h-5 rounded-sm border border-accent bg-accent flex items-center justify-center flex-shrink-0 mt-0.5">
            <Check className="w-3 h-3 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium text-text-primary">Investment Memo</p>
            <p className="text-sm text-text-secondary leading-relaxed">
              Generate a recommendation memo with executive summary, rationale, 
              risks, and citations from your evidence.
            </p>
          </div>
        </div>

        {/* Include corpus toggle - only when active */}
        {isActive && (
          <>
            <label className="hover-fade flex items-start gap-3 p-4 border border-stroke-subtle rounded cursor-pointer">
              <input
                type="checkbox"
                checked={includeCorpus}
                onChange={(e) => setIncludeCorpus(e.target.checked)}
                className="w-5 h-5 rounded-sm border-stroke-subtle text-accent focus:ring-accent focus:ring-offset-white mt-0.5"
              />
              <div>
                <div className="flex items-center gap-2">
                  <Library className="w-4 h-4 text-accent" />
                  <p className="text-sm font-medium text-text-primary">Include Case Study Library</p>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed">
                  Draw on our curated corpus of clean cooking case studies for 
                  additional context and lessons learned.
                </p>
              </div>
            </label>

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="btn-primary w-full px-6 py-3 rounded-none flex items-center justify-center gap-2"
            >
              {generating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Generating memo...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Generate Memo
                </>
              )}
            </button>

            {generating && (
              <p className="text-sm text-center text-text-tertiary">
                This may take 30-60 seconds...
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
