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
  isActive?: boolean;
}

export function MemoViewerWidget({ data, initiativeId, isActive = true }: MemoViewerWidgetProps) {
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
        bg: 'bg-forest/10', 
        text: 'text-forest',
        border: 'border-forest/30'
      },
      hold: { 
        icon: PauseCircle, 
        bg: 'bg-rust/10', 
        text: 'text-rust',
        border: 'border-rust/30'
      },
      reject: { 
        icon: AlertCircle, 
        bg: 'bg-primary-50', 
        text: 'text-primary-600',
        border: 'border-primary-200'
      },
    }[rec] || { icon: CheckCircle, bg: 'bg-beige', text: 'text-brown', border: 'border-beige' };
    
    const Icon = config.icon;

    return (
      <div className={`inline-flex items-center gap-2 px-5 py-2.5 ${config.bg} ${config.border} border rounded-pill shadow-subtle`}>
        <Icon className={`w-5 h-5 ${config.text}`} />
        <span className={`font-semibold uppercase tracking-wide ${config.text}`}>
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
    <div className="card-elevated overflow-hidden">
      {/* Header - Forest/success accent */}
      <div className="px-5 py-4 bg-gradient-to-r from-forest/10 to-teal/10 border-b border-beige/50 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-brown">{content.title}</h3>
          <p className="text-sm text-brown/60">{content.date}</p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-2.5 hover:bg-forest/10 rounded-pill transition-all duration-200"
        >
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-forest" />
          ) : (
            <ChevronDown className="w-5 h-5 text-forest" />
          )}
        </button>
      </div>

      {expanded && (
        <>
          {/* Content */}
          <div className="p-6 space-y-6 prose-memo max-h-[500px] overflow-y-auto bg-cream">
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
                <div className="space-y-3">
                  {content.citations.map((citation) => (
                    <div 
                      key={citation.number}
                      className={`
                        p-4 rounded-card border text-sm cursor-pointer transition-all duration-200
                        ${citation.source_type === 'corpus' 
                          ? 'bg-accent/10 border-accent/30 hover:bg-accent/20' 
                          : 'bg-teal/10 border-teal/30 hover:bg-teal/20'
                        }
                        ${selectedCitation?.number === citation.number ? 'ring-2 ring-primary-500 ring-offset-2 ring-offset-cream' : ''}
                      `}
                      onClick={() => setSelectedCitation(
                        selectedCitation?.number === citation.number ? null : citation
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span className="font-semibold text-brown">[{citation.number}]</span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            {citation.source_type === 'corpus' ? (
                              <BookOpen className="w-4 h-4 text-accent" />
                            ) : (
                              <ExternalLink className="w-4 h-4 text-teal" />
                            )}
                            <span className={`text-xs uppercase font-semibold tracking-wide ${
                              citation.source_type === 'corpus' ? 'text-accent' : 'text-teal'
                            }`}>
                              {citation.source_type === 'corpus' ? 'Case Study' : 'Your Evidence'}
                            </span>
                          </div>
                          <p className="font-medium text-brown mt-1">{citation.source_title}</p>
                          {selectedCitation?.number === citation.number && (
                            <p className="text-brown/70 mt-3 italic border-l-2 border-beige pl-3">
                              "{citation.excerpt}"
                            </p>
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
          <div className="px-5 py-4 bg-blush/50 border-t border-beige/50">
            <button
              onClick={handleExport}
              disabled={loading}
              className="btn-primary w-full"
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
