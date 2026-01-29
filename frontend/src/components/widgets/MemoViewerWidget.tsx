'use client';

import { useState } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { 
  Download, 
  Loader2, 
  ChevronDown, 
  ChevronUp,
  CheckCircle,
  AlertCircle,
  PauseCircle,
  BookOpen,
  ExternalLink
} from 'lucide-react';
import { MemoContent, Citation } from '@/lib/api';

interface MemoViewerWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
}

export function MemoViewerWidget({ data, initiativeId }: MemoViewerWidgetProps) {
  const [expanded, setExpanded] = useState(true);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const { exportMemo, loading } = useInitiativeStore();

  const content = data.content as MemoContent;

  const handleExport = async () => {
    await exportMemo(initiativeId);
  };

  const RecommendationBadge = () => {
    const rec = content.recommendation;
    const config = {
      proceed: { 
        icon: CheckCircle, 
        bg: 'bg-green-100', 
        text: 'text-green-800',
        border: 'border-green-200'
      },
      hold: { 
        icon: PauseCircle, 
        bg: 'bg-yellow-100', 
        text: 'text-yellow-800',
        border: 'border-yellow-200'
      },
      reject: { 
        icon: AlertCircle, 
        bg: 'bg-red-100', 
        text: 'text-red-800',
        border: 'border-red-200'
      },
    }[rec] || { icon: CheckCircle, bg: 'bg-gray-100', text: 'text-gray-800', border: 'border-gray-200' };
    
    const Icon = config.icon;

    return (
      <div className={`inline-flex items-center gap-2 px-4 py-2 ${config.bg} ${config.border} border rounded-full`}>
        <Icon className={`w-5 h-5 ${config.text}`} />
        <span className={`font-semibold uppercase ${config.text}`}>
          {rec}
        </span>
      </div>
    );
  };

  // Render text with citation links
  const renderWithCitations = (text: string) => {
    // Match [1], [2], etc.
    const parts = text.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/\[(\d+)\]/);
      if (match) {
        const num = parseInt(match[1]);
        const citation = content.citations.find(c => c.number === num);
        if (citation) {
          return (
            <button
              key={i}
              onClick={() => setSelectedCitation(citation)}
              className="citation"
              title={`${citation.source_title}`}
            >
              {part}
            </button>
          );
        }
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-green-50 to-emerald-100 border-b border-green-200 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-green-900">{content.title}</h3>
          <p className="text-sm text-green-700">{content.date}</p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-2 hover:bg-green-200 rounded-lg transition-colors"
        >
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-green-700" />
          ) : (
            <ChevronDown className="w-5 h-5 text-green-700" />
          )}
        </button>
      </div>

      {expanded && (
        <>
          {/* Content */}
          <div className="p-6 space-y-6 prose-memo max-h-[500px] overflow-y-auto">
            {/* Recommendation */}
            <div className="text-center py-4">
              <RecommendationBadge />
            </div>

            {/* Executive Summary */}
            <section>
              <h2>Executive Summary</h2>
              <p>{renderWithCitations(content.executive_summary)}</p>
            </section>

            {/* Recommendation Rationale */}
            <section>
              <h2>Recommendation Rationale</h2>
              <p>{renderWithCitations(content.recommendation_rationale)}</p>
            </section>

            {/* Evidence Summary */}
            <section>
              <h2>Evidence Summary</h2>
              <p>{renderWithCitations(content.evidence_summary)}</p>
            </section>

            {/* Risks and Assumptions */}
            <section>
              <h2>Risks and Assumptions</h2>
              <p>{renderWithCitations(content.risks_and_assumptions)}</p>
            </section>

            {/* Open Questions */}
            {content.open_questions.length > 0 && (
              <section>
                <h2>Open Questions</h2>
                <ul>
                  {content.open_questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* Citations */}
            {content.citations.length > 0 && (
              <section>
                <h2>References</h2>
                <div className="space-y-2">
                  {content.citations.map((citation) => (
                    <div 
                      key={citation.number}
                      className={`
                        p-3 rounded-lg border text-sm cursor-pointer transition-colors
                        ${citation.source_type === 'corpus' 
                          ? 'bg-purple-50 border-purple-200 hover:bg-purple-100' 
                          : 'bg-blue-50 border-blue-200 hover:bg-blue-100'
                        }
                        ${selectedCitation?.number === citation.number ? 'ring-2 ring-primary-500' : ''}
                      `}
                      onClick={() => setSelectedCitation(
                        selectedCitation?.number === citation.number ? null : citation
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-gray-700">[{citation.number}]</span>
                        <div>
                          <div className="flex items-center gap-2">
                            {citation.source_type === 'corpus' ? (
                              <BookOpen className="w-4 h-4 text-purple-600" />
                            ) : (
                              <ExternalLink className="w-4 h-4 text-blue-600" />
                            )}
                            <span className={`text-xs uppercase font-medium ${
                              citation.source_type === 'corpus' ? 'text-purple-600' : 'text-blue-600'
                            }`}>
                              {citation.source_type === 'corpus' ? 'Case Study' : 'Your Evidence'}
                            </span>
                          </div>
                          <p className="font-medium text-gray-900 mt-1">{citation.source_title}</p>
                          {selectedCitation?.number === citation.number && (
                            <p className="text-gray-600 mt-2 italic">"{citation.excerpt}"</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Actions */}
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
            <button
              onClick={handleExport}
              disabled={loading}
              className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Export to Word
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
