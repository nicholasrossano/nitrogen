'use client';

import { useState } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { FileText, Sparkles, Loader2, Check, Library } from 'lucide-react';

interface GenerateOptionsWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
}

export function GenerateOptionsWidget({ data, initiativeId }: GenerateOptionsWidgetProps) {
  const [includeCorpus, setIncludeCorpus] = useState(true);
  const { generateMemo, generating } = useInitiativeStore();

  const handleGenerate = async () => {
    await generateMemo(initiativeId, includeCorpus);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-purple-50 to-purple-100 border-b border-purple-200">
        <h3 className="font-semibold text-purple-900">Generate Memo</h3>
        <p className="text-sm text-purple-700">
          Evidence received: {data.chunk_count || 0} sections processed
        </p>
      </div>

      {/* Options */}
      <div className="p-4 space-y-4">
        {/* Memo option (always selected) */}
        <div className="flex items-start gap-3 p-3 bg-primary-50 border border-primary-200 rounded-lg">
          <div className="w-5 h-5 rounded border-2 border-primary-600 bg-primary-600 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Check className="w-3 h-3 text-white" />
          </div>
          <div>
            <p className="font-medium text-gray-900">Investment Memo</p>
            <p className="text-sm text-gray-600">
              Generate a recommendation memo with executive summary, rationale, 
              risks, and citations from your evidence.
            </p>
          </div>
        </div>

        {/* Include corpus toggle */}
        <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
          <input
            type="checkbox"
            checked={includeCorpus}
            onChange={(e) => setIncludeCorpus(e.target.checked)}
            className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 mt-0.5"
          />
          <div>
            <div className="flex items-center gap-2">
              <Library className="w-4 h-4 text-gray-600" />
              <p className="font-medium text-gray-900">Include Case Study Library</p>
            </div>
            <p className="text-sm text-gray-600">
              Draw on our curated corpus of clean cooking case studies for 
              additional context and lessons learned.
            </p>
          </div>
        </label>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="w-full px-4 py-3 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-lg font-medium hover:from-primary-700 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg"
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
          <p className="text-xs text-center text-gray-500">
            This may take 30-60 seconds...
          </p>
        )}
      </div>
    </div>
  );
}
