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
      {/* Header - Merlot/burgundy accent for generation */}
      <div className="px-5 py-4 bg-gradient-to-r from-merlot/10 to-primary-100 border-b border-beige/50">
        <h3 className="font-semibold text-brown">Generate Memo</h3>
        <p className="text-sm text-brown/60">
          Evidence received: {data.chunk_count || 0} sections processed
        </p>
      </div>

      {/* Options */}
      <div className="p-5 space-y-4 bg-cream">
        {/* Memo option (always selected) */}
        <div className="flex items-start gap-3 p-4 bg-primary-50 border border-primary-200 rounded-card">
          <div className="w-5 h-5 rounded-md border-2 border-primary-600 bg-primary-600 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Check className="w-3 h-3 text-white" />
          </div>
          <div>
            <p className="font-medium text-brown">Investment Memo</p>
            <p className="text-sm text-brown/70 leading-relaxed">
              Generate a recommendation memo with executive summary, rationale, 
              risks, and citations from your evidence.
            </p>
          </div>
        </div>

        {/* Include corpus toggle - only when active */}
        {isActive && (
          <>
            <label className="flex items-start gap-3 p-4 border border-beige rounded-card cursor-pointer hover:bg-blush/30 transition-all duration-200">
              <input
                type="checkbox"
                checked={includeCorpus}
                onChange={(e) => setIncludeCorpus(e.target.checked)}
                className="w-5 h-5 rounded-md border-beige text-primary-600 focus:ring-primary-500 focus:ring-offset-cream mt-0.5"
              />
              <div>
                <div className="flex items-center gap-2">
                  <Library className="w-4 h-4 text-accent" />
                  <p className="font-medium text-brown">Include Case Study Library</p>
                </div>
                <p className="text-sm text-brown/70 leading-relaxed">
                  Draw on our curated corpus of clean cooking case studies for 
                  additional context and lessons learned.
                </p>
              </div>
            </label>

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="w-full px-6 py-4 bg-gradient-to-r from-primary-600 to-merlot text-white rounded-pill font-semibold hover:from-primary-700 hover:to-merlot/90 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lifted hover:shadow-heavy"
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
              <p className="text-xs text-center text-brown/50">
                This may take 30-60 seconds...
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
